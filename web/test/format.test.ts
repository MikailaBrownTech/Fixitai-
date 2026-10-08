import { describe, expect, it } from 'vitest';
import { splitPartNumber } from '../lib/format';

describe('splitPartNumber: real titles seen from iFixit', () => {
  it.each([
    ['DC66-10170B - Samsung Washer Belt', 'DC66-10170B', 'Samsung Washer Belt'],
    ['WPW10260319 - Whirlpool Washer Belt', 'WPW10260319', 'Whirlpool Washer Belt'],
    ['GE Washer Drive Belt - WH01X27538', 'WH01X27538', 'GE Washer Drive Belt'],
    ['GE Washer Drive Belt -WH08X10050', 'WH08X10050', 'GE Washer Drive Belt'],
    ['Whirlpool Dryer Heating Element - WP3387749', 'WP3387749', 'Whirlpool Dryer Heating Element'],
    ['Whirlpool Dryer Heating Element - 279838', '279838', 'Whirlpool Dryer Heating Element'],
    ['30105-0051800-00 - Kenmore Refrigerator Ice Maker', '30105-0051800-00', 'Kenmore Refrigerator Ice Maker'],
    ['Refrigerator Ice Maker Assembly - DA97-07365G', 'DA97-07365G', 'Refrigerator Ice Maker Assembly'],
  ])('%s', (title, partNumber, name) => {
    expect(splitPartNumber(title)).toEqual({ partNumber, name });
  });
});

describe('splitPartNumber: leaves everything else alone', () => {
  it.each([
    'Samsung Combo Washer-Dryer Maintenance',
    'How to Replace the Xbox 360 Optical Drive Belt',
    'Whirlpool Dryer Heating Element (Varies)',
    'Dryer - Replacement', // "Replacement" has no digit, so it is not a part number
    'Washer Door - Assembly',
    'A - B',
    '',
  ])('%j comes back whole', (title) => {
    expect(splitPartNumber(title)).toEqual({ partNumber: null, name: title });
  });

  it('never changes the text, even when it looks like markup', () => {
    const t = '<img src=x onerror=alert(1)> - WH01X27538';
    const out = splitPartNumber(t);
    expect(out.partNumber).toBe('WH01X27538');
    expect(out.name).toBe('<img src=x onerror=alert(1)>');
  });

  it('does not treat a part number with spaces or odd characters as one', () => {
    expect(splitPartNumber('Belt - AB 1234')).toEqual({ partNumber: null, name: 'Belt - AB 1234' });
    expect(splitPartNumber('Belt - <b>1234</b>')).toEqual({ partNumber: null, name: 'Belt - <b>1234</b>' });
  });

  it('copes with very long input without hanging', () => {
    const long = 'a'.repeat(50_000) + ' - ' + 'b'.repeat(50_000);
    const start = Date.now();
    expect(splitPartNumber(long).partNumber).toBeNull();
    expect(Date.now() - start).toBeLessThan(500);
  });
});
