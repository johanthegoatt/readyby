"use strict";
const test = require("node:test");
const assert = require("node:assert");
const R = require("../src/engine.js");

test("parses times in 24h and am/pm", () => {
  assert.strictEqual(R.parseTime("18:30"), 18 * 60 + 30);
  assert.strictEqual(R.parseTime("6:30 pm"), 18 * 60 + 30);
  assert.strictEqual(R.parseTime("12:00 am"), 0);
  assert.strictEqual(R.parseTime("12:00 pm"), 12 * 60);
  assert.strictEqual(R.parseTime("9"), 9 * 60);
  assert.strictEqual(R.parseTime("25:00"), null);
  assert.strictEqual(R.parseTime("7:75"), null);
  assert.strictEqual(R.parseTime("nope"), null);
});

test("formats minutes to HH:MM and wraps midnight", () => {
  assert.strictEqual(R.fmtTime(18 * 60 + 5), "18:05");
  assert.strictEqual(R.fmtTime(-30), "23:30");
  assert.strictEqual(R.fmtTime(1440 + 15), "00:15");
});

test("formats durations in hours and minutes", () => {
  assert.strictEqual(R.fmtDuration(45), "45 min");
  assert.strictEqual(R.fmtDuration(60), "1 hr");
  assert.strictEqual(R.fmtDuration(95), "1 hr 35 min");
});

test("reads weights in pounds and kilograms", () => {
  assert.strictEqual(R.pounds("12"), 12);
  assert.strictEqual(R.pounds("12 lb"), 12);
  assert.ok(Math.abs(R.pounds("5 kg") - 11.023) < 0.01);
  assert.strictEqual(R.pounds("0"), null);
  assert.strictEqual(R.pounds("-3"), null);
  assert.strictEqual(R.pounds("abc"), null);
});

test("cook time scales with weight for a turkey", () => {
  const turkey = R.byId("turkey");
  const ct = R.cookTime(turkey, { weight: 12 });
  // 13-15 min/lb * 12 = 156-180 min.
  assert.strictEqual(ct.low, 156);
  assert.strictEqual(ct.high, 180);
});

test("a stuffed turkey takes longer than an unstuffed one", () => {
  const a = R.cookTime(R.byId("turkey"), { weight: 14 });
  const b = R.cookTime(R.byId("turkey-stuffed"), { weight: 14 });
  assert.ok(b.high > a.high);
});

test("fixed sides ignore weight", () => {
  const ct = R.cookTime(R.byId("roast-potatoes"), { weight: 99 });
  assert.deepStrictEqual(ct, { low: 45, high: 55 });
});

test("beef doneness changes the time and the pull temperature", () => {
  const beef = R.byId("beef");
  const medium = R.cookTime(beef, { weight: 4, doneness: "medium" });
  const rare = R.cookTime(beef, { weight: 4, doneness: "medium-rare" });
  assert.ok(rare.high < medium.high);
  assert.strictEqual(R.pullTemp(beef, { doneness: "medium" }).f, 145);
  assert.strictEqual(R.pullTemp(beef, { doneness: "medium" }).belowSafe, false);
  const mr = R.pullTemp(beef, { doneness: "medium-rare" });
  assert.strictEqual(mr.f, 135);
  assert.strictEqual(mr.belowSafe, true);
});

test("poultry pull temperature is the USDA 165F minimum", () => {
  assert.strictEqual(R.pullTemp(R.byId("chicken")).f, 165);
  assert.strictEqual(R.pullTemp(R.byId("turkey")).f, 165);
});

test("plan schedules a dish to finish exactly at serve time (sides) ", () => {
  const plan = R.planMeal({ serveTime: "18:00", items: [{ id: "roast-potatoes" }] });
  assert.ok(plan.ok);
  const spud = plan.items[0];
  assert.strictEqual(spud.serveAt, 18 * 60);
  assert.strictEqual(spud.outAt, 18 * 60); // no rest
  // start = serve - high time (plan from the longer estimate)
  assert.strictEqual(spud.startAt, 18 * 60 - 55);
});

test("a meat comes out of the oven before serving to rest", () => {
  const plan = R.planMeal({ serveTime: "18:00", items: [{ id: "turkey", weight: 12 }] });
  const bird = plan.items[0];
  // rest 20, so out at 17:40; start = 17:40 - 180 = 14:40
  assert.strictEqual(bird.outAt, 17 * 60 + 40);
  assert.strictEqual(bird.startAt, 17 * 60 + 40 - 180);
});

test("errors on missing serve time, no items, or a meat with no weight", () => {
  assert.strictEqual(R.planMeal({ items: [{ id: "turkey", weight: 10 }] }).ok, false);
  assert.strictEqual(R.planMeal({ serveTime: "18:00", items: [] }).ok, false);
  assert.strictEqual(R.planMeal({ serveTime: "18:00", items: [{ id: "turkey" }] }).ok, false);
});

test("oven clash: potatoes at 425F and turkey at 325F overlap", () => {
  const plan = R.planMeal({
    serveTime: "18:00",
    items: [{ id: "turkey", weight: 12 }, { id: "roast-potatoes" }]
  });
  assert.ok(plan.ovenConflicts.length >= 1);
  const c = plan.ovenConflicts[0];
  assert.deepStrictEqual(c.temps, [325, 425]);
  assert.ok(c.to > c.from);
});

test("no clash when the only oven dish is alone", () => {
  const plan = R.planMeal({ serveTime: "18:00", items: [{ id: "chicken", weight: 4 }] });
  assert.strictEqual(plan.ovenConflicts.length, 0);
});

test("hob dishes never clash with the oven", () => {
  const plan = R.planMeal({
    serveTime: "18:00",
    items: [{ id: "turkey", weight: 12 }, { id: "steamed-veg" }, { id: "mash" }]
  });
  assert.strictEqual(plan.ovenConflicts.length, 0);
});

test("rest window is found while a single resting meat sits out", () => {
  const plan = R.planMeal({
    serveTime: "18:00",
    items: [{ id: "turkey", weight: 12 }, { id: "roast-potatoes" }]
  });
  assert.ok(plan.restWindow);
  assert.strictEqual(plan.restWindow.minutes, 20); // turkey rest
  // the 425F potatoes fit in the 20-min hot gap and are suggested
  assert.ok(plan.restWindow.suggest.indexOf("Roast potatoes") !== -1);
});

test("steps are ordered by time, serving last before the leftovers reminder", () => {
  const plan = R.planMeal({
    serveTime: "18:00",
    items: [{ id: "chicken", weight: 4 }, { id: "gravy" }]
  });
  const ats = plan.steps.map(s => s.at);
  for (let i = 1; i < ats.length; i++) assert.ok(ats[i] >= ats[i - 1]);
  // The cooking ends with serving; the only thing after it is the fridge reminder.
  const cookingSteps = plan.steps.filter(s => s.kind !== "away");
  assert.strictEqual(cookingSteps[cookingSteps.length - 1].kind, "serve");
  assert.strictEqual(plan.steps[plan.steps.length - 1].kind, "away");
});

test("first start is the earliest hand needed and matches the span", () => {
  const plan = R.planMeal({ serveTime: "18:00", items: [{ id: "turkey", weight: 12 }] });
  assert.strictEqual(plan.firstStart, plan.items[0].startAt);
  assert.strictEqual(plan.totalSpan, plan.serveTime - plan.firstStart);
});

test("holding window is 2 hours after serving by default", () => {
  const h = R.holdingWindow("18:00");
  assert.strictEqual(h.limitMins, 120);
  assert.strictEqual(h.hotRoom, false);
  assert.strictEqual(h.awayBy, R.parseTime("20:00"));
});

test("a hot room (above 90F) cuts the window to 1 hour", () => {
  const h = R.holdingWindow("18:00", { hotRoom: true });
  assert.strictEqual(h.limitMins, 60);
  assert.strictEqual(h.hotRoom, true);
  assert.strictEqual(h.awayBy, R.parseTime("19:00"));
});

test("holding window wrap flag is set for a late serving", () => {
  assert.strictEqual(R.holdingWindow("23:30").wrapped, true);
  assert.strictEqual(R.holdingWindow("18:00").wrapped, false);
});

test("planMeal carries the holding window and an 'away' step", () => {
  const plan = R.planMeal({ serveTime: "18:00", items: [{ id: "turkey", weight: 12 }] });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.holding.awayBy, R.parseTime("20:00"));
  const away = plan.steps.find((s) => s.kind === "away");
  assert.ok(away, "has an away step");
  assert.strictEqual(away.at, R.parseTime("20:00"));
  // the away step is the very last thing the cook does
  assert.strictEqual(plan.steps[plan.steps.length - 1].kind, "away");
});

test("oven pull sits below the target by the carryover rise", () => {
  // Beef pulled to medium (target 145F), carryover 5-10F: pull at 135-140F.
  const op = R.ovenPull(R.byId("beef"), { doneness: "medium" });
  assert.strictEqual(op.targetF, 145);
  assert.strictEqual(op.fromF, 135); // bigger/hotter roast carries over more (10F)
  assert.strictEqual(op.toF, 140);   // smaller roast carries over less (5F)
  assert.strictEqual(op.riseLow, 5);
  assert.strictEqual(op.riseHigh, 10);
});

test("a chosen doneness moves the oven-pull window with the target", () => {
  const med = R.ovenPull(R.byId("beef"), { doneness: "medium" });       // target 145
  const rare = R.ovenPull(R.byId("beef"), { doneness: "medium-rare" }); // target 135
  assert.ok(rare.fromF < med.fromF && rare.toF < med.toF);
});

test("hob and finish dishes have no oven-pull", () => {
  assert.strictEqual(R.ovenPull(R.byId("mash"), {}), null);
  assert.strictEqual(R.ovenPull(R.byId("gravy"), {}), null);
  assert.strictEqual(R.ovenPull(R.byId("roast-potatoes"), {}), null); // no rest
});

test("planMeal attaches the oven-pull to a resting roast and names it in the rest step", () => {
  const plan = R.planMeal({ serveTime: "18:00", items: [{ id: "chicken", weight: 4 }] });
  const bird = plan.items.find((p) => p.id === "chicken");
  assert.ok(bird.ovenPull, "chicken has an oven-pull");
  assert.strictEqual(bird.ovenPull.targetF, 165);
  assert.strictEqual(bird.ovenPull.fromF, 157); // 165 - 8
  const restStep = plan.steps.find((s) => s.kind === "rest");
  assert.ok(/climbs to about 165F/.test(restStep.text));
});

test("keepWarm: warm oven holds safely, quality caps at ~2 hours", () => {
  const r = R.keepWarm({ minutesEarly: 40, method: "warm-oven" });
  assert.equal(r.safe, true);
  assert.equal(r.safeHotC, 60);
  assert.equal(r.qualityMinutes, 120);
  assert.match(r.note, /warm oven/);
});

test("keepWarm: a long warm-oven hold warns on quality, not safety", () => {
  const r = R.keepWarm({ minutesEarly: 150, method: "warm-oven" });
  assert.equal(r.safe, true);
  assert.match(r.note, /quality drops/);
});

test("keepWarm: resting is fine up to 45 min, then move to the oven", () => {
  assert.match(R.keepWarm({ minutesEarly: 30, method: "resting" }).note, /tented in foil/);
  assert.match(R.keepWarm({ minutesEarly: 70, method: "resting" }).note, /warm oven/);
});

test("keepWarm: left out follows the 2-hour rule", () => {
  const ok = R.keepWarm({ minutesEarly: 90, method: "room" });
  assert.equal(ok.safe, true);
  const over = R.keepWarm({ minutesEarly: 150, method: "room" });
  assert.equal(over.safe, false);
  assert.equal(over.overByMinutes, 30);
});

test("keepWarm: defaults to the warm-oven method", () => {
  assert.equal(R.keepWarm({ minutesEarly: 20 }).method, "warm-oven");
});
