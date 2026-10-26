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
//      for the same sulfur means less SO2 per kg, so longer. The fruit is
//      crates x the packhouse crate weight in Settings (~20 kg): Boord's
//      crate weights are field picking crates (~7 kg) and must not be used;
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
  const fruitKg = input.crates * s.ref_crate_kg;
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

// The batch number a run gets when it starts, made on the tablet so it works
// with no Wi-Fi: T2-4104-1057-B15/8a-K7 = tent 2, date code 4104, 10:57 (the
// tablet's own clock, farm time), fruit from blocks 15 and 8a, and two
// characters of the run's uuid so two tablets starting in the same minute
// still differ. The date code is the ISO week's last digit, the weekday
// (Monday 1 ... Sunday 7), 0, then the week's first digit: Monday of week 44 is
// 4104, of week 45 5104, of week 52 2105, of week 5 5100.
// Sources are the picked fruit sources: blocks are B<id>, bought-in suppliers
// S<id>; a letter is not repeated when it follows the same letter (B15/8a,
// but B15/S2).
function dateCode(when) {
  const day = (when.getDay() + 6) % 7 + 1;                                  // Monday 1 ... Sunday 7
  const thursday = new Date(when.getFullYear(), when.getMonth(), when.getDate() + 4 - day);
  const week = Math.ceil(((thursday - new Date(thursday.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${week % 10}${day}0${Math.floor(week / 10)}`;
}

function batchNo(tentId, when, sources, uuid) {
  const p = (n) => String(n).padStart(2, "0");
  let last = "";
  const fruit = sources.map((s) => {
    const letter = s.supplier_id != null ? "S" : "B";
    const code = `${letter === last ? "" : letter}${s.supplier_id != null ? s.supplier_id : s.block_id}`;
    last = letter;
    return code;
  }).join("/");
  return `T${tentId}-${dateCode(when)}-${p(when.getHours())}${p(when.getMinutes())}-${fruit}-${uuid.replace(/-/g, "").slice(0, 2).toUpperCase()}`;
}

if (typeof module !== "undefined") module.exports = { suggestMinutes, describeSuggestion, estimateResidue, batchNo, dateCode };
