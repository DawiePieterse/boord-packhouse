// The suggested sulfur time for a tent load.
//
// There is no published formula for litchi sulfur time: the science is
// "dose = SO2 concentration x time", and the SA industry times are empirical.
// So this is a transparent starting rule the farm tunes in Settings -> Sulfur
// (backend models.SulfurSettings explains each number), never a calculation
// from first principles. The operator always sees why, and can override it.
//
// The tent's default minutes is its time at the reference conditions. It is
// scaled, one step at a time so each step can be shown, by:
//   1. fruit per gram of sulfur, against the reference pallet - more fruit
//      for the same sulfur means less SO2 per kg, so longer;
//   2. the weather - hot and dry raises residue, so shorter;
//   3. the variety's factor - McLean's Red takes up more than Mauritius;
// then rounded and kept between the minimum and maximum.
//
// The aril SO2 estimate follows from that design: the suggestion is the time
// that keeps residue where it was at the reference conditions, so a chosen
// time t gives roughly anchor ppm x t / (unrounded suggestion). Residue goes
// with SO2 dose = concentration x time. The anchor is one residue at the
// reference conditions - an assumption until a lab result replaces it.
//
// Plain functions and no DOM, so `node frontend/suggest_check.js` can test it.

function suggestMinutes(input, settings) {
  const s = settings;
  const steps = [];
  let minutes = input.baseMinutes;
  const step = (label, factor) => {
    const before = minutes;
    minutes *= factor;
    if (Math.abs(minutes - before) >= 0.5) steps.push({ label, delta: Math.round(minutes - before) });
  };

  // 1. Fruit per gram of sulfur.
  const crateKg = input.crateKg > 0 ? input.crateKg : s.ref_crate_kg;
  const fruitKg = input.crates * crateKg;
  const refKgPerGram = (s.ref_crates * s.ref_crate_kg) / s.ref_grams;
  if (input.grams > 0) {
    const factor = (fruitKg / input.grams) / refKgPerGram;
    step(factor > 1 ? "more fruit per gram" : "less fruit per gram", factor);
  }

  // 2. Weather, from whichever reading the tablet has.
  const hasTemp = input.temp != null && !Number.isNaN(input.temp);
  const hasHumidity = input.humidity != null && !Number.isNaN(input.humidity);
  if (hasTemp || hasHumidity) {
    const tempPart = hasTemp ? -(s.temp_pct_per_deg * (input.temp - s.ref_temp)) / 100 : 0;
    const humidityPart = hasHumidity ? (s.humidity_pct_per_pct * (input.humidity - s.ref_humidity)) / 100 : 0;
    const factor = Math.max(0.1, 1 + tempPart + humidityPart);
    const reading = [hasTemp ? `${Math.round(input.temp)}°C` : "", hasHumidity ? `${Math.round(input.humidity)}%` : ""]
      .filter(Boolean).join(" ");
    step(`${factor < 1 ? "hot & dry" : "cool & humid"} ${reading}`, factor);
  }

  // 3. Variety, matched without regard to case or spaces.
  const factors = typeof s.variety_factors === "string" ? JSON.parse(s.variety_factors || "{}") : (s.variety_factors || {});
  const wanted = (input.variety || "").trim().toLowerCase();
  const match = Object.keys(factors).find((k) => k.trim().toLowerCase() === wanted);
  if (wanted && match) step(match, Number(factors[match]));

  const rounded = Math.round(minutes / s.round_to) * s.round_to;
  const final = Math.min(s.max_minutes, Math.max(s.min_minutes, rounded));
  return { minutes: final, raw: minutes, fruitKg: Math.round(fruitKg), steps, clamped: final !== rounded };
}

// "60 base · +4 more fruit per gram · −6 hot & dry 31°C 40% · −5 McLean's Red"
function describeSuggestion(baseMinutes, result) {
  const parts = [`${baseMinutes} base`].concat(result.steps.map((st) =>
    `${st.delta > 0 ? "+" : "−"}${Math.abs(st.delta)} ${st.label}`));
  if (result.clamped) parts.push("kept within the limits");
  return parts.join(" · ");
}

// Estimated aril SO2 (ppm) for running `minutes` where suggestMinutes gave
// `result`, and how it stands against the EU limit: "ok", "warn" or "over".
function estimateResidue(minutes, result, settings) {
  const ppm = result.raw > 0 ? (settings.residue_ref_ppm * minutes) / result.raw : null;
  if (ppm == null) return null;
  const level = ppm >= settings.residue_limit_ppm ? "over" : ppm >= settings.residue_warn_ppm ? "warn" : "ok";
  return { ppm: Math.round(ppm * 10) / 10, level };
}

if (typeof module !== "undefined") module.exports = { suggestMinutes, describeSuggestion, estimateResidue };
