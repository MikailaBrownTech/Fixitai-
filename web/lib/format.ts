/**
 * Splits an iFixit part title such as "DC66-10170B - Samsung Washer Belt" or
 * "GE Washer Drive Belt - WH01X27538" into the part number and the readable name, so the page
 * can show the number as its own tag. People copy part numbers to a retailer, so they should be
 * easy to see and select.
 *
 * This only decides WHICH PART of the string goes where. The text is never changed, and the
 * caller must still render both pieces as plain text. If a title does not clearly contain a part
 * number, it comes back whole with no number.
 */
export interface SplitTitle {
  name: string;
  partNumber: string | null;
}

// A part number: no spaces, 4 to 24 characters from a small set, and at least one digit
// (so ordinary words like "Assembly" or "Replacement" can never be mistaken for one).
const NUMBER = '[A-Za-z0-9][A-Za-z0-9./-]{3,23}';
const LEADING = new RegExp(`^(${NUMBER})\\s*-\\s+(\\S.*)$`);
const TRAILING = new RegExp(`^(\\S.*?)\\s+-\\s*(${NUMBER})$`);

const hasDigit = (s: string) => /\d/.test(s);

export function splitPartNumber(title: string): SplitTitle {
  const leading = LEADING.exec(title);
  if (leading && hasDigit(leading[1]!)) return { partNumber: leading[1]!, name: leading[2]! };

  const trailing = TRAILING.exec(title);
  if (trailing && hasDigit(trailing[2]!)) return { partNumber: trailing[2]!, name: trailing[1]! };

  return { partNumber: null, name: title };
}
