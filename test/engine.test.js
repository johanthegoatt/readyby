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

test("steps are ordered by time and end with serving", () => {
  const plan = R.planMeal({
    serveTime: "18:00",
    items: [{ id: "chicken", weight: 4 }, { id: "gravy" }]
  });
  const ats = plan.steps.map(s => s.at);
  for (let i = 1; i < ats.length; i++) assert.ok(ats[i] >= ats[i - 1]);
  assert.strictEqual(plan.steps[plan.steps.length - 1].kind, "serve");
});

test("first start is the earliest hand needed and matches the span", () => {
  const plan = R.planMeal({ serveTime: "18:00", items: [{ id: "turkey", weight: 12 }] });
  assert.strictEqual(plan.firstStart, plan.items[0].startAt);
  assert.strictEqual(plan.totalSpan, plan.serveTime - plan.firstStart);
});
