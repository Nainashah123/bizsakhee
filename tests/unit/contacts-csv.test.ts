import { describe, expect, it } from "vitest";

import {
  contactsToCsv,
  escapeCsvCell,
  mapHeaders,
  normalizeHeader,
  parseCsv,
  toCsv,
} from "@/lib/contacts/csv";

describe("parseCsv", () => {
  it("splits a simple file into headers and numbered records", () => {
    const document = parseCsv(
      "Name,Phone\nMeera,9876543210\nRitu,9812345678\n",
    );

    expect(document.headers).toEqual(["Name", "Phone"]);
    expect(document.records).toHaveLength(2);
    expect(document.records[0]).toEqual({
      line: 2,
      cells: ["Meera", "9876543210"],
    });
    expect(document.records[1].line).toBe(3);
  });

  it("keeps commas that sit inside quoted fields", () => {
    const document = parseCsv('Name,City\n"Nair, Meera","Kochi, Kerala"\n');

    expect(document.records[0].cells).toEqual(["Nair, Meera", "Kochi, Kerala"]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    const document = parseCsv(
      'Name,Note\n"Meera","She said ""yes"" already"\n',
    );

    expect(document.records[0].cells[1]).toBe('She said "yes" already');
  });

  it("keeps a newline that is inside a quoted field and keeps line numbers honest", () => {
    const document = parseCsv(
      'Name,Note\n"Meera","line one\nline two"\nRitu,short\n',
    );

    expect(document.records).toHaveLength(2);
    expect(document.records[0].cells[1]).toBe("line one\nline two");
    // The second record starts on physical line 4 because the note wrapped.
    expect(document.records[1]).toEqual({ line: 4, cells: ["Ritu", "short"] });
  });

  it("handles CRLF line endings and a UTF-8 byte order mark", () => {
    const document = parseCsv("﻿Name,Phone\r\nMeera,9876543210\r\n");

    expect(document.headers).toEqual(["Name", "Phone"]);
    expect(document.records[0].cells).toEqual(["Meera", "9876543210"]);
  });

  it("skips blank lines but not rows of empty values", () => {
    const document = parseCsv("Name,Phone\nMeera,9876543210\n\n,\nRitu,\n");

    expect(document.records.map((record) => record.cells)).toEqual([
      ["Meera", "9876543210"],
      ["", ""],
      ["Ritu", ""],
    ]);
  });

  it("does not lose the last row when the file has no trailing newline", () => {
    const document = parseCsv("Name,Phone\nMeera,9876543210");

    expect(document.records).toHaveLength(1);
    expect(document.records[0].cells[1]).toBe("9876543210");
  });

  it("keeps a malformed row rather than discarding it, so it can be reported", () => {
    const document = parseCsv(
      "Name,Phone,City\nMeera,9876543210\nRitu,1,2,3\n",
    );

    expect(document.records[0].cells).toHaveLength(2);
    expect(document.records[1].cells).toHaveLength(4);
  });

  it("returns nothing usable for an empty file", () => {
    expect(parseCsv("")).toEqual({ headers: [], records: [] });
  });
});

describe("normalizeHeader and mapHeaders", () => {
  it("folds case, punctuation and spacing", () => {
    expect(normalizeHeader("  Full_Name ")).toBe("full name");
    expect(normalizeHeader("E-Mail")).toBe("e mail");
  });

  it("maps common spreadsheet headings to fields", () => {
    const map = mapHeaders([
      "Customer Name",
      "Mobile Number",
      "E-Mail",
      "Town",
      "Source",
      "Tags",
    ]);

    expect(map).toEqual({
      fullName: 0,
      phone: 1,
      email: 2,
      city: 3,
      leadSource: 4,
      tags: 5,
    });
  });

  it("ignores columns it does not recognise and keeps the first of a repeat", () => {
    const map = mapHeaders(["Name", "Loyalty points", "Full name"]);

    expect(map.fullName).toBe(0);
    expect(Object.keys(map)).toEqual(["fullName"]);
  });

  it("reports a missing name column as undefined", () => {
    expect(mapHeaders(["Phone", "City"]).fullName).toBeUndefined();
  });
});

describe("escapeCsvCell", () => {
  it("leaves plain values alone", () => {
    expect(escapeCsvCell("Meera Nair")).toBe("Meera Nair");
  });

  it("quotes values containing a comma, quote or newline", () => {
    expect(escapeCsvCell("Nair, Meera")).toBe('"Nair, Meera"');
    expect(escapeCsvCell('She said "yes"')).toBe('"She said ""yes"""');
    expect(escapeCsvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes values with leading or trailing spaces so they survive a round trip", () => {
    expect(escapeCsvCell(" padded ")).toBe('" padded "');
  });

  it("neutralises spreadsheet formula injection", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("+91 98765 43210")).toBe("'+91 98765 43210");
  });

  it("renders null and undefined as an empty cell", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("writes CRLF rows with a trailing newline", () => {
    expect(toCsv(["A", "B"], [["1", "2"]])).toBe("A,B\r\n1,2\r\n");
  });

  it("round-trips through parseCsv", () => {
    const csv = toCsv(
      ["Name", "Note"],
      [
        ["Nair, Meera", 'She said "yes"'],
        ["Ritu", "line one\nline two"],
      ],
    );

    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(["Name", "Note"]);
    expect(parsed.records[0].cells).toEqual(["Nair, Meera", 'She said "yes"']);
    expect(parsed.records[1].cells).toEqual(["Ritu", "line one\nline two"]);
  });
});

describe("contactsToCsv", () => {
  const contact = {
    fullName: "Meera Nair",
    phoneDisplay: "+91 98765 43210",
    phoneNormalized: "919876543210",
    email: "meera@example.com",
    city: "Kochi",
    leadSource: "Instagram",
    status: "active",
    nextFollowUpAt: "2026-09-01T04:30:00.000Z",
    createdAt: "2026-08-01T04:30:00.000Z",
    tags: ["vip", "repeat"],
  };

  it("writes one row per contact under the export headers", () => {
    const csv = contactsToCsv([contact]);
    const parsed = parseCsv(csv);

    expect(parsed.headers).toEqual([
      "Name",
      "Phone",
      "Email",
      "City",
      "Lead source",
      "Status",
      "Next follow up",
      "Tags",
      "Created",
    ]);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].cells[0]).toBe("Meera Nair");
    // The display number opens with "+", so it is escaped against injection.
    expect(parsed.records[0].cells[1]).toBe("'+91 98765 43210");
    expect(parsed.records[0].cells[7]).toBe("vip; repeat");
  });

  it("falls back to the normalised number and empties missing values", () => {
    const csv = contactsToCsv([
      {
        ...contact,
        phoneDisplay: null,
        email: null,
        city: null,
        leadSource: null,
        nextFollowUpAt: null,
        tags: [],
      },
    ]);

    const cells = parseCsv(csv).records[0].cells;
    expect(cells[1]).toBe("919876543210");
    expect(cells[2]).toBe("");
    expect(cells[6]).toBe("");
    expect(cells[7]).toBe("");
  });
});
