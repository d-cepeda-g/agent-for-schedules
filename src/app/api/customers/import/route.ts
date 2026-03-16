import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isLikelyPhoneNumber } from "@/lib/validation";

interface CsvRow {
  name: string;
  phone: string;
  email: string;
  notes: string;
  preferredLanguage: string;
}

interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

const VALID_LANGUAGES = new Set([
  "English",
  "Spanish",
  "German",
  "French",
  "Turkish",
]);

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z]/g, "");
}

const HEADER_MAP: Record<string, keyof CsvRow> = {
  name: "name",
  fullname: "name",
  contactname: "name",
  phone: "phone",
  phonenumber: "phone",
  telephone: "phone",
  tel: "phone",
  mobile: "phone",
  cell: "phone",
  email: "email",
  emailaddress: "email",
  notes: "notes",
  note: "notes",
  comment: "notes",
  comments: "notes",
  language: "preferredLanguage",
  preferredlanguage: "preferredLanguage",
  lang: "preferredLanguage",
};

function mapHeaders(
  headers: string[]
): { mapping: Record<number, keyof CsvRow>; missing: string[] } {
  const mapping: Record<number, keyof CsvRow> = {};
  const found = new Set<keyof CsvRow>();

  for (let i = 0; i < headers.length; i++) {
    const normalized = normalizeHeader(headers[i]);
    const field = HEADER_MAP[normalized];
    if (field && !found.has(field)) {
      mapping[i] = field;
      found.add(field);
    }
  }

  const missing: string[] = [];
  if (!found.has("name")) missing.push("name");
  if (!found.has("phone")) missing.push("phone");

  return { mapping, missing };
}

export async function POST(request: NextRequest) {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Failed to read request body" },
      { status: 400 }
    );
  }

  if (!text.trim()) {
    return NextResponse.json(
      { error: "Empty CSV content" },
      { status: 400 }
    );
  }

  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return NextResponse.json(
      { error: "CSV must have a header row and at least one data row" },
      { status: 400 }
    );
  }

  const headerFields = parseCsvLine(lines[0]);
  const { mapping, missing } = mapHeaders(headerFields);

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Missing required columns: ${missing.join(", ")}. Found columns: ${headerFields.join(", ")}`,
      },
      { status: 400 }
    );
  }

  // Parse rows
  const rows: { lineNum: number; data: CsvRow }[] = [];
  const result: ImportResult = { created: 0, skipped: 0, errors: [] };

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const row: CsvRow = {
      name: "",
      phone: "",
      email: "",
      notes: "",
      preferredLanguage: "English",
    };

    for (const [colIdx, field] of Object.entries(mapping)) {
      const value = fields[Number(colIdx)] ?? "";
      row[field] = value.trim();
    }

    // Validate required fields
    if (!row.name) {
      result.errors.push({ row: i + 1, reason: "Missing name" });
      continue;
    }
    if (!row.phone) {
      result.errors.push({ row: i + 1, reason: "Missing phone" });
      continue;
    }
    if (!isLikelyPhoneNumber(row.phone)) {
      result.errors.push({
        row: i + 1,
        reason: `Invalid phone number: ${row.phone}`,
      });
      continue;
    }

    // Normalize language
    if (row.preferredLanguage && !VALID_LANGUAGES.has(row.preferredLanguage)) {
      row.preferredLanguage = "English";
    }

    rows.push({ lineNum: i + 1, data: row });
  }

  // Look up existing phones to skip duplicates
  const phones = rows.map((r) => r.data.phone);
  const existing = await db.customer.findMany({
    where: { phone: { in: phones } },
    select: { phone: true },
  });
  const existingPhones = new Set(existing.map((c) => c.phone));

  // Insert new customers
  for (const row of rows) {
    if (existingPhones.has(row.data.phone)) {
      result.skipped++;
      result.errors.push({
        row: row.lineNum,
        reason: `Phone ${row.data.phone} already exists`,
      });
      continue;
    }

    try {
      await db.customer.create({
        data: {
          name: row.data.name,
          phone: row.data.phone,
          email: row.data.email,
          notes: row.data.notes,
          preferredLanguage: row.data.preferredLanguage || "English",
        },
      });
      result.created++;
      existingPhones.add(row.data.phone);
    } catch {
      result.errors.push({
        row: row.lineNum,
        reason: `Failed to create customer (possible duplicate phone)`,
      });
    }
  }

  return NextResponse.json(result);
}
