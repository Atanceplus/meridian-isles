import type { OwnedUpgradeRow, UpgradeCategory } from "../persistence/types";
import type { CommandService } from "./commands";
import { ValidationError } from "./errors";

/**
 * Outfitter's Wharf: record what you bought for the business elsewhere. Nothing
 * here touches XP; owned upgrades only decorate HQ.
 */

const CATEGORIES: UpgradeCategory[] = ["leads", "crm", "dialer", "training", "equipment", "service", "other"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface UpgradeInput {
  id?: string;
  catalogId?: string | null;
  category: UpgradeCategory;
  name: string;
  description?: string;
  capabilities?: string;
  purchasedOn: string;
  reportedCost: number | null;
  quantity?: number | null;
  subscription?: OwnedUpgradeRow["subscription"];
  notes?: string;
}

export class ShopCommands {
  constructor(private svc: CommandService) {}

  async saveUpgrade(instanceId: string, input: UpgradeInput): Promise<OwnedUpgradeRow> {
    const tx = await this.svc.begin(instanceId);
    const existing = input.id ? tx.bundle.ownedUpgrades.find((u) => u.id === input.id) : undefined;
    const errors: string[] = [];
    if (input.id && !existing) errors.push("That upgrade no longer exists.");
    if (!CATEGORIES.includes(input.category)) errors.push("Choose a category.");
    if (!input.name.trim() || input.name.length > 120) errors.push("Give it a name under 120 characters.");
    if (!DATE_RE.test(input.purchasedOn)) errors.push("Enter the purchase date.");
    else if (input.purchasedOn > tx.at.slice(0, 10)) errors.push("The purchase date is in the future.");
    if (input.reportedCost !== null && !(input.reportedCost >= 0)) errors.push("Cost can't be negative.");
    if (input.quantity != null && (!Number.isInteger(input.quantity) || input.quantity < 0)) errors.push("Quantity must be a whole number.");
    if (input.catalogId && !tx.registry.seeds.catalog.some((c) => c.id === input.catalogId)) errors.push("Unknown catalog item.");
    if (input.subscription?.renewsOn && !DATE_RE.test(input.subscription.renewsOn)) errors.push("Enter a valid renewal date.");
    if (errors.length) throw new ValidationError(errors);

    const quantity = input.quantity ?? null;
    // Remaining starts at the quantity; later quantity changes shift it by the same amount.
    const remaining = quantity === null ? null : existing?.remaining != null && existing.quantity != null ? Math.max(0, existing.remaining + (quantity - existing.quantity)) : quantity;
    const row: OwnedUpgradeRow = {
      id: existing?.id ?? tx.id(),
      instanceId,
      catalogId: input.catalogId ?? existing?.catalogId ?? null,
      category: input.category,
      name: input.name.trim(),
      description: (input.description ?? "").trim(),
      capabilities: (input.capabilities ?? "").trim(),
      purchasedOn: input.purchasedOn,
      reportedCost: input.reportedCost,
      currency: tx.bundle.instance.settings.currency,
      quantity,
      remaining,
      subscription: input.subscription ?? null,
      notes: (input.notes ?? "").trim(),
      history: existing?.history ?? [{ at: tx.at, text: "Recorded" }],
      archived: existing?.archived ?? false,
      createdAt: existing?.createdAt ?? tx.at,
      updatedAt: tx.at,
    };
    tx.rows("ownedUpgrades").push(row);
    tx.audit(existing ? "upgrade.update" : "upgrade.create", row.id, `${existing ? "Updated" : "Recorded"} ${row.name}`, existing, row);
    await tx.commit();
    return row;
  }

  /** Use up (negative) or restock (positive) a consumable such as leads. */
  async adjustRemaining(instanceId: string, id: string, delta: number, note = ""): Promise<OwnedUpgradeRow> {
    const tx = await this.svc.begin(instanceId);
    const u = tx.bundle.ownedUpgrades.find((x) => x.id === id);
    if (!u) throw new ValidationError(["That upgrade no longer exists."]);
    if (u.remaining === null) throw new ValidationError([`${u.name} doesn't track a quantity.`]);
    if (!Number.isInteger(delta) || delta === 0) throw new ValidationError(["Enter a whole number to add or use."]);
    const remaining = u.remaining + delta;
    if (remaining < 0) throw new ValidationError([`Only ${u.remaining} remaining.`]);
    const text = `${delta > 0 ? `Added ${delta}` : `Used ${-delta}`} (${remaining} left)${note.trim() ? ` — ${note.trim()}` : ""}`;
    const row: OwnedUpgradeRow = { ...u, remaining, quantity: delta > 0 ? (u.quantity ?? 0) + delta : u.quantity, history: [...u.history, { at: tx.at, text }], updatedAt: tx.at };
    tx.rows("ownedUpgrades").push(row);
    tx.audit("upgrade.inventory", id, text);
    await tx.commit();
    return row;
  }

  async setArchived(instanceId: string, id: string, archived: boolean): Promise<void> {
    const tx = await this.svc.begin(instanceId);
    const u = tx.bundle.ownedUpgrades.find((x) => x.id === id);
    if (!u) throw new ValidationError(["That upgrade no longer exists."]);
    tx.rows("ownedUpgrades").push({ ...u, archived, history: [...u.history, { at: tx.at, text: archived ? "Archived" : "Restored" }], updatedAt: tx.at });
    tx.audit(archived ? "upgrade.archive" : "upgrade.restore", id, `${archived ? "Archived" : "Restored"} ${u.name}`);
    await tx.commit();
  }
}
