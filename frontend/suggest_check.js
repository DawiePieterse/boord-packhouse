// Self-check for suggest.js:  node frontend/suggest_check.js
// Also run by backend/tests/test_suggest.py.
const assert = require("assert");
const { suggestMinutes, describeSuggestion } = require("./suggest.js");

const settings = {
  ref_grams: 425, ref_crates: 24, ref_crate_kg: 20, ref_temp: 25, ref_humidity: 60,
  temp_pct_per_deg: 2, humidity_pct_per_pct: 0.5, min_minutes: 30, max_minutes: 120, round_to: 5,
  variety_factors: '{"Mauritius": 1.0, "McLean\'s Red": 0.9}',
};
const load = { baseMinutes: 60, grams: 425, crates: 24, crateKg: 20, variety: "Mauritius", temp: 25, humidity: 60 };

// The reference load gets the tent's default, with nothing to explain.
let r = suggestMinutes(load, settings);
assert.strictEqual(r.minutes, 60);
assert.deepStrictEqual(r.steps, []);
assert.strictEqual(r.fruitKg, 480);

// Half a pallet with the same sulfur: half the fruit per gram -> 30 min.
assert.strictEqual(suggestMinutes({ ...load, crates: 12 }, settings).minutes, 30);

// Hot and dry is shorter, cool and humid longer: 31 °C, 40 % -> 1 - 0.12 - 0.10 = 0.78 -> 46.8 -> 45.
r = suggestMinutes({ ...load, temp: 31, humidity: 40 }, settings);
assert.strictEqual(r.minutes, 45);
assert.ok(r.steps[0].label.startsWith("hot & dry") && r.steps[0].delta === -13);
assert.ok(suggestMinutes({ ...load, temp: 18, humidity: 85 }, settings).minutes > 60);

// McLean's Red at 0.9, matched whatever the case: 54 -> 55.
r = suggestMinutes({ ...load, variety: "mclean's red" }, settings);
assert.strictEqual(r.minutes, 55);
assert.strictEqual(describeSuggestion(60, r), "60 base · −6 McLean's Red");

// Unknown crate weight or variety, no weather: the reference values, no steps.
r = suggestMinutes({ ...load, crateKg: null, variety: "Bought-in", temp: null, humidity: null }, settings);
assert.strictEqual(r.minutes, 60);
assert.deepStrictEqual(r.steps, []);

// Kept within the limits, and says so.
r = suggestMinutes({ ...load, crates: 2 }, settings);
assert.strictEqual(r.minutes, 30);
assert.ok(describeSuggestion(60, r).endsWith("kept within the limits"));

// Zero percentages and factors of 1.0 make it the plain tent default.
const flat = { ...settings, temp_pct_per_deg: 0, humidity_pct_per_pct: 0, variety_factors: "{}" };
assert.strictEqual(suggestMinutes({ ...load, temp: 38, humidity: 10, variety: "McLean's Red" }, flat).minutes, 60);

console.log("suggest.js: all checks passed");
