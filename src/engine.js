// Readyby engine: work out when to start every dish so the whole meal is ready
// at the same moment.
//
// The hard part of cooking a roast isn't any one dish, it's getting the meat,
// the potatoes and the veg to land together. Readyby schedules backwards from
// the time you want to serve. Each dish has a cooking time (fixed, or by weight
// for the meats) and the meats also have a rest, so they come out of the oven
// early, sit, and are carved just as everything else is dished up.
//
// Times follow the USDA / FoodSafety.gov roasting guidance and the pull
// temperatures are the USDA safe minimums (poultry 165F; beef, pork and lamb
// 145F with a 3-minute rest). A clock is only ever an estimate, so the plan
// shows a window and always names the temperature to check with a thermometer.
//
// Two useful extras fall out of scheduling backwards:
//   - Oven clashes. If two oven dishes want different temperatures at the same
//     time, that is flagged with the exact minutes and both temperatures.
//   - The rest window. While the meat rests out of the oven, the oven is free
//     and hot, which is the moment to blast the roast potatoes. Readyby spots
//     that gap and says so.
//
// Pure functions, no page code, so the browser and `node --test` run the same
// logic.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Readyby = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- the dish catalogue -------------------------------------------------
  //
  // kind: "oven" dishes hold the oven at tempF; "hob" dishes are on the stove
  // top and never clash with the oven; "finish" dishes (gravy, carving) have no
  // oven need. byWeight dishes take a weight in pounds and use minPerLb; fixed
  // dishes ignore weight and use minFixed. rest is minutes out of the oven
  // before serving. safeF (when present) is the USDA pull temperature.

  var CATALOG = [
    // Centrepieces, timed by weight.
    {
      id: "chicken",
      name: "Whole chicken",
      kind: "oven",
      tempF: 350,
      byWeight: true,
      minPerLb: [20, 25],
      rest: 15,
      safeF: 165,
      icon: "chicken",
      note: "Roast at 350F until the thickest part of the thigh reads 165F."
    },
    {
      id: "turkey",
      name: "Turkey, unstuffed",
      kind: "oven",
      tempF: 325,
      byWeight: true,
      minPerLb: [13, 15],
      rest: 20,
      safeF: 165,
      icon: "turkey",
      note: "Roast at 325F to 165F in the thigh. Loosely tent with foil if it browns early."
    },
    {
      id: "turkey-stuffed",
      name: "Turkey, stuffed",
      kind: "oven",
      tempF: 325,
      byWeight: true,
      minPerLb: [15, 18],
      rest: 20,
      safeF: 165,
      icon: "turkey",
      note: "The stuffing itself must reach 165F, so a stuffed bird takes longer."
    },
    {
      id: "beef",
      name: "Beef roast",
      kind: "oven",
      tempF: 350,
      byWeight: true,
      minPerLb: [18, 22], // to a pull around medium; adjusted by doneness below
      rest: 15,
      safeF: 145,
      doneness: true,
      icon: "beef",
      note: "USDA safe is 145F then a 3-minute rest. Pull earlier only by choice."
    },
    {
      id: "pork",
      name: "Pork loin roast",
      kind: "oven",
      tempF: 350,
      byWeight: true,
      minPerLb: [20, 22],
      rest: 10,
      safeF: 145,
      icon: "pork",
      note: "Pull at 145F and rest 3 minutes (USDA). Pork is fine faintly pink."
    },
    {
      id: "lamb",
      name: "Leg of lamb, bone-in",
      kind: "oven",
      tempF: 325,
      byWeight: true,
      minPerLb: [15, 20],
      rest: 15,
      safeF: 145,
      doneness: true,
      icon: "lamb",
      note: "USDA safe is 145F and a 3-minute rest."
    },

    // Oven sides, fixed time.
    { id: "roast-potatoes", name: "Roast potatoes", kind: "oven", tempF: 425, minFixed: [45, 55], rest: 0, icon: "potato", note: "Hottest dish on the list. Loves the oven free while the meat rests." },
    { id: "yorkshires", name: "Yorkshire puddings", kind: "oven", tempF: 425, minFixed: [20, 25], rest: 0, icon: "yorkshire", note: "Go in hot and are best served straight away." },
    { id: "stuffing", name: "Stuffing tray", kind: "oven", tempF: 350, minFixed: [30, 40], rest: 0, icon: "stuffing", note: "Reaches 165F through the middle." },
    { id: "roast-veg", name: "Roasted carrots and parsnips", kind: "oven", tempF: 400, minFixed: [30, 40], rest: 0, icon: "veg", note: "Turn once halfway for even colour." },
    { id: "pigs", name: "Pigs in blankets", kind: "oven", tempF: 400, minFixed: [25, 35], rest: 0, icon: "pigs", note: "Sausage reaches 160F." },

    // Hob sides, fixed time, never fight the oven.
    { id: "steamed-veg", name: "Steamed greens", kind: "hob", minFixed: [8, 12], rest: 0, icon: "greens", note: "On the hob, so no oven clash." },
    { id: "mash", name: "Mashed potatoes", kind: "hob", minFixed: [20, 25], rest: 0, icon: "mash", note: "On the hob. Keep warm with a lid." },
    { id: "gravy", name: "Gravy", kind: "finish", minFixed: [8, 12], rest: 0, icon: "gravy", note: "Made last, from the meat's resting juices." }
  ];

  // Doneness pull temperatures for the dishes that offer a choice. "safe" is the
  // USDA minimum; the others are a cook's choice and shown with that caveat.
  var DONENESS = {
    beef: { rare: { f: 125, mult: 0.82 }, "medium-rare": { f: 135, mult: 0.9 }, medium: { f: 145, mult: 1 }, "well-done": { f: 160, mult: 1.15 } },
    lamb: { "medium-rare": { f: 135, mult: 0.85 }, medium: { f: 145, mult: 1 }, "well-done": { f: 160, mult: 1.15 } }
  };

  function byId(id) {
    for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].id === id) return CATALOG[i];
    return null;
  }

  // ---- time helpers -------------------------------------------------------

  // Parse "HH:MM" (24h) or "h:mm am/pm" into minutes since midnight, or null.
  function parseTime(s) {
    if (typeof s !== "string") return null;
    var t = s.trim().toLowerCase();
    var ampm = null;
    var m = t.match(/\b(am|pm)\b/);
    if (m) { ampm = m[1]; t = t.replace(/\s*(am|pm)\b/, ""); }
    var parts = t.split(":");
    if (parts.length < 1 || parts.length > 2) return null;
    var h = parseInt(parts[0], 10);
    var min = parts.length === 2 ? parseInt(parts[1], 10) : 0;
    if (!isFinite(h) || !isFinite(min) || min < 0 || min > 59) return null;
    if (ampm) {
      if (h < 1 || h > 12) return null;
      if (ampm === "pm" && h !== 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
    } else if (h < 0 || h > 23) return null;
    return h * 60 + min;
  }

  // Minutes since midnight to "HH:MM" (24h), wrapping across midnight.
  function fmtTime(mins) {
    var m = ((Math.round(mins) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
  }

  // A friendly duration, e.g. 95 -> "1 hr 35 min".
  function fmtDuration(mins) {
    mins = Math.round(mins);
    if (mins < 60) return mins + " min";
    var h = Math.floor(mins / 60), m = mins % 60;
    return h + " hr" + (m ? " " + m + " min" : "");
  }

  // Read a weight in pounds. Accepts "12", "12.5", "12 lb", "5.4 kg" (-> lb).
  function pounds(v) {
    if (typeof v === "number") return isFinite(v) && v > 0 ? v : null;
    if (typeof v !== "string") return null;
    var t = v.trim().toLowerCase();
    if (t.indexOf("-") !== -1) return null; // no negatives or ranges
    var isKg = /kg|kilo/.test(t);
    var num = parseFloat(t.replace(/[^0-9.]/g, ""));
    if (!isFinite(num) || num <= 0) return null;
    return isKg ? num * 2.2046226 : num;
  }

  // ---- cooking time for one dish -----------------------------------------

  // Returns { low, high } minutes for a dish. Weight dishes multiply the per-lb
  // range by the weight; beef and lamb also scale by the chosen doneness.
  function cookTime(dish, opts) {
    opts = opts || {};
    if (!dish) return null;
    var low, high;
    if (dish.byWeight) {
      var lb = pounds(opts.weight);
      if (lb == null) return null;
      low = dish.minPerLb[0] * lb;
      high = dish.minPerLb[1] * lb;
      if (dish.doneness && opts.doneness && DONENESS[dish.id] && DONENESS[dish.id][opts.doneness]) {
        var mult = DONENESS[dish.id][opts.doneness].mult;
        low *= mult; high *= mult;
      }
    } else {
      low = dish.minFixed[0];
      high = dish.minFixed[1];
    }
    return { low: Math.round(low), high: Math.round(high) };
  }

  // The pull temperature actually used for a dish, honouring a doneness choice
  // but never below the USDA safe minimum unless the cook asked for it.
  function pullTemp(dish, opts) {
    opts = opts || {};
    if (!dish || dish.safeF == null) return null;
    if (dish.doneness && opts.doneness && DONENESS[dish.id] && DONENESS[dish.id][opts.doneness]) {
      return { f: DONENESS[dish.id][opts.doneness].f, belowSafe: DONENESS[dish.id][opts.doneness].f < dish.safeF };
    }
    return { f: dish.safeF, belowSafe: false };
  }

  // ---- the plan -----------------------------------------------------------

  // planMeal({ serveTime, items: [{ id, weight?, doneness? }] })
  //
  // Schedules everything backwards from serveTime. Each item gets:
  //   startAt   when to begin it (minutes since midnight)
  //   ovenInAt  when it goes in the oven (oven dishes only)
  //   outAt     when it comes out of the oven / off the hob
  //   serveAt   = serveTime (sides) or outAt + rest carried to serveTime (meat)
  // Plans from the longer (high) time estimate so you are never caught short.
  function planMeal(input) {
    input = input || {};
    var serve = typeof input.serveTime === "number" ? input.serveTime : parseTime(input.serveTime);
    if (serve == null) return { ok: false, error: "Enter a serving time like 18:30." };
    var items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) return { ok: false, error: "Add at least one dish." };

    var planned = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var dish = byId(it.id);
      if (!dish) return { ok: false, error: "Unknown dish: " + it.id };
      var ct = cookTime(dish, it);
      if (!ct) return { ok: false, error: "Add a weight for the " + dish.name.toLowerCase() + "." };

      var rest = dish.rest || 0;
      // The dish must be ready (carved/served) at serve time. Meats come out of
      // the oven `rest` minutes before serve so they can sit.
      var outAt = serve - rest;
      var startHigh = outAt - ct.high;
      var startLow = outAt - ct.low;

      planned.push({
        id: dish.id,
        name: dish.name,
        kind: dish.kind,
        tempF: dish.tempF || null,
        icon: dish.icon,
        note: dish.note,
        weight: dish.byWeight ? pounds(it.weight) : null,
        doneness: dish.doneness && it.doneness ? it.doneness : null,
        cook: ct,
        rest: rest,
        pull: pullTemp(dish, it),
        startAt: startHigh,          // plan from the longer estimate
        startAtEarliest: startLow,
        ovenInAt: dish.kind === "oven" ? startHigh : null,
        outAt: outAt,
        serveAt: serve
      });
    }

    // The earliest a hand is needed, for the summary line.
    var firstStart = planned.reduce(function (a, p) { return Math.min(a, p.startAt); }, serve);

    var ovenConflicts = ovenClashes(planned);
    var rest = restWindowHint(planned, serve);

    // A single ordered list of actions the cook follows top to bottom.
    var steps = buildSteps(planned, serve);

    return {
      ok: true,
      serveTime: serve,
      firstStart: firstStart,
      totalSpan: serve - firstStart,
      items: planned,
      ovenConflicts: ovenConflicts,
      restWindow: rest,
      steps: steps
    };
  }

  // Walk the minutes and find where two oven dishes want different temperatures.
  function ovenClashes(planned) {
    var oven = planned.filter(function (p) { return p.kind === "oven" && p.tempF; });
    if (oven.length < 2) return [];
    var start = oven.reduce(function (a, p) { return Math.min(a, p.ovenInAt); }, Infinity);
    var end = oven.reduce(function (a, p) { return Math.max(a, p.outAt); }, -Infinity);
    var clashes = [];
    var open = null; // current running clash interval
    for (var t = start; t < end; t++) {
      var activeTemps = {};
      var active = [];
      for (var i = 0; i < oven.length; i++) {
        var p = oven[i];
        if (t >= p.ovenInAt && t < p.outAt) { activeTemps[p.tempF] = true; active.push(p); }
      }
      var temps = Object.keys(activeTemps);
      if (temps.length > 1) {
        if (!open) open = { from: t, tos: {}, names: {} };
        open.to = t + 1;
        for (var j = 0; j < active.length; j++) { open.tos[active[j].tempF] = true; open.names[active[j].name] = active[j].tempF; }
      } else if (open) { clashes.push(finishClash(open)); open = null; }
    }
    if (open) clashes.push(finishClash(open));
    return clashes;
  }

  function finishClash(open) {
    var temps = Object.keys(open.tos).map(Number).sort(function (a, b) { return a - b; });
    var dishes = Object.keys(open.names).map(function (n) { return { name: n, tempF: open.names[n] }; });
    return { from: open.from, to: open.to, temps: temps, dishes: dishes };
  }

  // If exactly one dish is the oven's hot hog and it rests, the oven is free and
  // hot during the rest. That gap is the moment for the roast potatoes.
  function restWindowHint(planned, serve) {
    var resting = planned.filter(function (p) { return p.kind === "oven" && p.rest > 0; });
    if (resting.length !== 1) return null;
    var meat = resting[0];
    var gapFrom = meat.outAt, gapTo = serve;
    if (gapTo - gapFrom < 5) return null;
    // Oven sides still cooking during the gap now have the oven to themselves
    // and can take the higher heat the meat was holding down.
    var movable = planned.filter(function (p) {
      if (p.kind !== "oven" || p.id === meat.id) return false;
      return p.ovenInAt < gapTo && p.outAt > gapFrom; // overlaps the gap
    }).map(function (p) { return p.name; });
    return { from: gapFrom, to: gapTo, minutes: gapTo - gapFrom, meat: meat.name, suggest: movable };
  }

  // Build the ordered action list. Each oven/hob dish becomes a "start" step;
  // meats add an "out and rest" step; the meal ends with a "serve" step.
  function buildSteps(planned, serve) {
    var steps = [];
    planned.forEach(function (p) {
      steps.push({
        at: p.startAt,
        kind: "start",
        dish: p.name,
        text: (p.kind === "oven" ? "Into the oven" + (p.tempF ? " at " + p.tempF + "F" : "") : p.kind === "hob" ? "Start on the hob" : "Start") + ": " + p.name + " (" + fmtDuration(p.cook.low) + " to " + fmtDuration(p.cook.high) + ")"
      });
      if (p.rest > 0) {
        steps.push({
          at: p.outAt,
          kind: "rest",
          dish: p.name,
          text: "Take out " + p.name + " and let it rest" + (p.pull ? " (check " + p.pull.f + "F)" : "")
        });
      }
    });
    steps.push({ at: serve, kind: "serve", dish: null, text: "Dish up and serve" });
    steps.sort(function (a, b) {
      if (a.at !== b.at) return a.at - b.at;
      var order = { start: 0, rest: 1, serve: 2 };
      return order[a.kind] - order[b.kind];
    });
    return steps;
  }

  return {
    CATALOG: CATALOG,
    DONENESS: DONENESS,
    byId: byId,
    parseTime: parseTime,
    fmtTime: fmtTime,
    fmtDuration: fmtDuration,
    pounds: pounds,
    cookTime: cookTime,
    pullTemp: pullTemp,
    planMeal: planMeal
  };
});
