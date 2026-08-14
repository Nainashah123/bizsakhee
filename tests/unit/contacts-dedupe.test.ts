import { describe, expect, it } from "vitest";

import {
  buildDedupeIndex,
  classifyImportRows,
  findDuplicate,
  parseCsv,
  type ExistingContactKey,
} from "@/lib/contacts/csv";

const MEERA: ExistingContactKey = {
  id: "contact-meera",
  fullName: "Meera Nair",
  phoneNormalized: "919876543210",
  emailNormalized: "meera@example.com",
};

const RITU: ExistingContactKey = {
  id: "contact-ritu",
  fullName: "Ritu Sharma",
  phoneNormalized: null,
  emailNormalized: "ritu@example.com",
};

describe("buildDedupeIndex", () => {
  it("indexes phone and email separately and ignores blanks", () => {
    const index = buildDedupeIndex([MEERA, RITU]);

    expect([...index.byPhone.keys()]).toEqual(["919876543210"]);
    expect([...index.byEmail.keys()].sort()).toEqual([
      "meera@example.com",
      "ritu@example.com",
    ]);
  });

  it("keeps the first contact when two share a key", () => {
    const index = buildDedupeIndex([
      MEERA,
      { ...MEERA, id: "newer", fullName: "Meera Duplicate" },
    ]);

    expect(index.byPhone.get("919876543210")?.id).toBe("contact-meera");
  });
});

describe("findDuplicate", () => {
  const index = buildDedupeIndex([MEERA, RITU]);

  it("matches the same Indian number however it is written", () => {
    for (const written of [
      "+91 98765 43210",
      "919876543210",
      "09876543210",
      "98765-43210",
      "  +91-98765-43210  ",
    ]) {
      const hit = findDuplicate({ phone: written }, index);
      expect(hit, `expected ${written} to match`).not.toBeNull();
      expect(hit?.contactId).toBe("contact-meera");
      expect(hit?.field).toBe("phone");
    }
  });

  it("does not match a different number that merely looks similar", () => {
    expect(findDuplicate({ phone: "9876543211" }, index)).toBeNull();
    expect(findDuplicate({ phone: "8765432109" }, index)).toBeNull();
  });

  it("matches email regardless of case and surrounding space", () => {
    const hit = findDuplicate({ email: "  Ritu@Example.COM " }, index);

    expect(hit?.contactId).toBe("contact-ritu");
    expect(hit?.field).toBe("email");
  });

  it("prefers a phone match over an email match", () => {
    const hit = findDuplicate(
      { phone: "9876543210", email: "ritu@example.com" },
      index,
    );

    expect(hit?.field).toBe("phone");
    expect(hit?.contactId).toBe("contact-meera");
  });

  it("respects the workspace country when no dialling code is given", () => {
    const singapore = buildDedupeIndex([
      {
        id: "sg",
        fullName: "Aunty Lim",
        phoneNormalized: "6581234567",
        emailNormalized: null,
      },
    ]);

    expect(
      findDuplicate({ phone: "81234567" }, singapore, "SG")?.contactId,
    ).toBe("sg");
    expect(findDuplicate({ phone: "81234567" }, singapore, "IN")).toBeNull();
  });

  it("returns null when there is nothing to compare", () => {
    expect(findDuplicate({}, index)).toBeNull();
    expect(findDuplicate({ phone: "", email: "" }, index)).toBeNull();
    expect(findDuplicate({ phone: "not a number" }, index)).toBeNull();
  });
});

describe("classifyImportRows", () => {
  const classify = (csv: string, existing: ExistingContactKey[] = []) =>
    classifyImportRows(parseCsv(csv), { existing });

  it("accepts a clean row and normalises what it stores", () => {
    const result = classify(
      "Name,Phone,Email,City,Source,Tags\nAsha Menon,098765 43211,ASHA@Example.com ,Kochi,Instagram,vip; repeat\n",
    );

    expect(result.invalid).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toMatchObject({
      line: 2,
      fullName: "Asha Menon",
      phoneNormalized: "919876543211",
      phoneDisplay: "+91 98765 43211",
      email: "asha@example.com",
      city: "Kochi",
      leadSource: "Instagram",
      status: "active",
      tags: ["vip", "repeat"],
    });
  });

  it("flags a row whose phone or email cannot be used", () => {
    const result = classify(
      "Name,Phone,Email\nBad Phone,12345,ok@example.com\nBad Email,9876543210,not-an-email\n",
    );

    expect(result.valid).toEqual([]);
    expect(result.invalid).toHaveLength(2);
    expect(result.invalid[0]).toMatchObject({ line: 2, label: "Bad Phone" });
    expect(result.invalid[0].reasons[0]).toContain("12345");
    expect(result.invalid[1].reasons[0]).toContain("not-an-email");
  });

  it("flags a missing name, an unknown status and an unreadable date", () => {
    const result = classify(
      "Name,Status,Follow up\n,active,2026-09-01\nAsha,maybe,2026-09-01\nBina,active,next tuesday-ish\n",
    );

    expect(result.valid).toEqual([]);
    expect(result.invalid.map((row) => row.line)).toEqual([2, 3, 4]);
    expect(result.invalid[0].reasons).toContain("Name is missing.");
    expect(result.invalid[1].reasons[0]).toContain("maybe");
    expect(result.invalid[2].reasons[0]).toContain("next tuesday-ish");
  });

  it("flags a row with the wrong number of columns instead of shifting its values", () => {
    const result = classify(
      "Name,Phone,City\nAsha,9876543211,Kochi\nBina,9876543212\n",
    );

    expect(result.valid.map((row) => row.fullName)).toEqual(["Asha"]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].reasons[0]).toBe(
      "Expected 3 columns but found 2.",
    );
  });

  it("reports a row that already exists in the workspace, with a link target", () => {
    const result = classify(
      "Name,Phone\nMeera N,+91 98765 43210\nAsha,9876543211\n",
      [MEERA],
    );

    expect(result.valid.map((row) => row.fullName)).toEqual(["Asha"]);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]).toMatchObject({
      line: 2,
      label: "Meera N",
      contactId: "contact-meera",
    });
    expect(result.duplicates[0].reason).toContain("already saved");
  });

  it("imports a number repeated inside the same file only once", () => {
    const result = classify(
      "Name,Phone\nAsha,9876543211\nAsha again,098765 43211\n",
    );

    expect(result.valid).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].contactId).toBeNull();
    expect(result.duplicates[0].reason).toContain("earlier in this file");
  });

  it("catches a repeated email inside the same file too", () => {
    const result = classify(
      "Name,Email\nAsha,asha@example.com\nAsha Menon,ASHA@example.com\n",
    );

    expect(result.valid).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].reason).toContain("email address");
  });

  it("treats a repeated bare name as a duplicate but allows two people with different numbers", () => {
    const repeated = classify("Name\nAsha Menon\nasha   menon\n");
    expect(repeated.valid).toHaveLength(1);
    expect(repeated.duplicates[0].reason).toContain("already appears");

    const distinct = classify(
      "Name,Phone\nAsha Menon,9876543211\nAsha Menon,9876543212\n",
    );
    expect(distinct.valid).toHaveLength(2);
    expect(distinct.duplicates).toEqual([]);
  });

  it("never reports the same row twice", () => {
    const result = classify(
      "Name,Phone\n,+91 98765 43210\nMeera N,+91 98765 43210\n",
      [MEERA],
    );

    // Row 2 is invalid (no name) so it is not also counted as a duplicate.
    expect(result.invalid.map((row) => row.line)).toEqual([2]);
    expect(result.duplicates.map((row) => row.line)).toEqual([3]);
    expect(result.valid).toEqual([]);
  });

  it("stops at the row limit and says so", () => {
    const rows = Array.from(
      { length: 5 },
      (_, index) => `Person ${index},98765432${10 + index}`,
    ).join("\n");
    const result = classifyImportRows(parseCsv(`Name,Phone\n${rows}\n`), {
      existing: [],
      maxRows: 3,
    });

    expect(result.valid).toHaveLength(3);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].reasons[0]).toContain("first 3 rows");
  });

  it("uses the workspace country when normalising imported numbers", () => {
    const result = classifyImportRows(parseCsv("Name,Phone\nLim,81234567\n"), {
      existing: [],
      defaultCountry: "SG",
    });

    expect(result.valid[0].phoneNormalized).toBe("6581234567");
  });
});
