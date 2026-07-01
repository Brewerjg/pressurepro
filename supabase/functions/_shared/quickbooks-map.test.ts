import { describe, it, expect } from "vitest";
import {
  parseInvoiceLines,
  buildInvoiceLines,
  buildPaymentPayload,
} from "./quickbooks-map.ts";

describe("parseInvoiceLines", () => {
  it("normalizes the standard { name, qty, rate, total } shape", () => {
    const raw = [{ id: "a", name: "Spring cleanup", qty: 1, rate: 250, total: 250 }];
    expect(parseInvoiceLines(raw)).toEqual([
      { name: "Spring cleanup", qty: 1, rate: 250, total: 250 },
    ]);
  });

  it("synthesizes qty/rate/total from a legacy sqft × rate row", () => {
    const raw = [{ label: "Driveway", sqft: 100, rate: 0.5 }];
    expect(parseInvoiceLines(raw)).toEqual([
      { name: "Driveway", qty: 100, rate: 0.5, total: 50 },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(parseInvoiceLines(null)).toEqual([]);
    expect(parseInvoiceLines({})).toEqual([]);
  });
});

describe("buildInvoiceLines", () => {
  it("maps each line onto the default item with the name as description", () => {
    const lines = [{ name: "Mulch install", qty: 2, rate: 90, total: 180 }];
    expect(buildInvoiceLines(lines, "ITEM7")).toEqual([
      {
        Amount: 180,
        DetailType: "SalesItemLineDetail",
        Description: "Mulch install",
        SalesItemLineDetail: {
          ItemRef: { value: "ITEM7" },
          Qty: 2,
          UnitPrice: 90,
        },
      },
    ]);
  });
});

describe("buildPaymentPayload", () => {
  it("converts cents to dollars and links the payment to the invoice", () => {
    expect(buildPaymentPayload(15000, "INV42", "CUST9")).toEqual({
      CustomerRef: { value: "CUST9" },
      TotalAmt: 150,
      Line: [
        { Amount: 150, LinkedTxn: [{ TxnId: "INV42", TxnType: "Invoice" }] },
      ],
    });
  });
});
