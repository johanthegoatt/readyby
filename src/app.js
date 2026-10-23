// Readyby page wiring. Picks dishes, reads the serving time, asks the engine for
// a backward schedule and draws the timeline, the warnings and the pull
// temperatures. All the real work is in engine.js so the browser and the tests
// run the same logic.
(function () {
  "use strict";
  var R = window.Readyby;

  var serveEl = document.getElementById("serve");
  var hotRoomEl = document.getElementById("hot-room");
  var chipsMeat = document.getElementById("chips-meat");
  var chipsOven = document.getElementById("chips-oven");
  var chipsHob = document.getElementById("chips-hob");
  var meatDetail = document.getElementById("meat-detail");
  var result = document.getElementById("result");
  var verdict = document.getElementById("verdict");
  var warnings = document.getElementById("warnings");
  var timeline = document.getElementById("timeline");
  var temps = document.getElementById("temps");

  var MEATS = R.CATALOG.filter(function (d) { return d.byWeight; });
  var OVEN = R.CATALOG.filter(function (d) { return d.kind === "oven" && !d.byWeight; });
  var HOB = R.CATALOG.filter(function (d) { return d.kind === "hob" || d.kind === "finish"; });

  // State.
  var meatSel = null;          // dish id or null
  var meatWeight = "";         // raw string
  var meatDoneness = "medium"; // for beef/lamb
  var sides = {};              // id -> true

  function chip(dish, selected) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (selected ? " on" : "");
    b.textContent = dish.name;
    b.setAttribute("aria-pressed", selected ? "true" : "false");
    b.dataset.id = dish.id;
    return b;
  }

  function renderChips() {
    chipsMeat.innerHTML = "";
    MEATS.forEach(function (d) {
      var b = chip(d, meatSel === d.id);
      b.addEventListener("click", function () {
        meatSel = meatSel === d.id ? null : d.id;
        renderChips();
        renderMeatDetail();
        if (window.Ding) window.Ding.context(meatSel ? "meat" : "start");
      });
      chipsMeat.appendChild(b);
    });
    chipsOven.innerHTML = "";
    OVEN.forEach(function (d) {
      var b = chip(d, !!sides[d.id]);
      b.addEventListener("click", function () { toggleSide(d.id); });
      chipsOven.appendChild(b);
    });
    chipsHob.innerHTML = "";
    HOB.forEach(function (d) {
      var b = chip(d, !!sides[d.id]);
      b.addEventListener("click", function () { toggleSide(d.id); });
      chipsHob.appendChild(b);
    });
  }

  function toggleSide(id) {
    if (sides[id]) delete sides[id]; else sides[id] = true;
    renderChips();
  }

  function renderMeatDetail() {
    if (!meatSel) { meatDetail.classList.add("hidden"); meatDetail.innerHTML = ""; return; }
    var dish = R.byId(meatSel);
    meatDetail.classList.remove("hidden");
    var html =
      '<label class="field weight-field"><span>Weight of the ' + dish.name.toLowerCase() + '</span>' +
      '<input id="weight" type="text" inputmode="decimal" placeholder="e.g. 12 lb or 5 kg" value="' + (meatWeight || "") + '"></label>';
    if (dish.doneness) {
      var opts = Object.keys(R.DONENESS[dish.id]).map(function (k) {
        var label = k.replace(/-/g, " ");
        return '<option value="' + k + '"' + (meatDoneness === k ? " selected" : "") + '>' + label + " (" + R.DONENESS[dish.id][k].f + "F)</option>";
      }).join("");
      html += '<label class="field"><span>How you like it</span><select id="doneness">' + opts + "</select></label>";
    }
    html += '<p class="meat-note">' + dish.note + "</p>";
    meatDetail.innerHTML = html;
    var w = document.getElementById("weight");
    w.addEventListener("input", function () { meatWeight = w.value; });
    var dn = document.getElementById("doneness");
    if (dn) dn.addEventListener("change", function () { meatDoneness = dn.value; });
  }

  function collectItems() {
    var items = [];
    if (meatSel) {
      var it = { id: meatSel, weight: meatWeight };
      var dish = R.byId(meatSel);
      if (dish.doneness) it.doneness = meatDoneness;
      items.push(it);
    }
    Object.keys(sides).forEach(function (id) { items.push({ id: id }); });
    return items;
  }

  function relative(firstStart) {
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var diff = firstStart - nowMin;
    if (diff < -720) diff += 1440; // assume later today / tomorrow wrap
    if (diff >= -2 && diff <= 180) {
      if (diff <= 2) return "That's about now";
      return "That's in about " + R.fmtDuration(diff);
    }
    return "";
  }

  function plan() {
    var items = collectItems();
    if (!items.length) {
      if (window.Ding) window.Ding.react("worried");
      verdict.textContent = "";
      result.classList.remove("hidden");
      warnings.innerHTML = '<p class="warn">Pick at least one dish first.</p>';
      timeline.innerHTML = ""; temps.innerHTML = "";
      return;
    }
    if (window.Ding) window.Ding.react("thinking");
    var out = R.planMeal({ serveTime: serveEl.value, items: items, hotRoom: hotRoomEl && hotRoomEl.checked });
    result.classList.remove("hidden");
    if (!out.ok) {
      if (window.Ding) window.Ding.react("worried");
      verdict.textContent = "";
      warnings.innerHTML = '<p class="warn">' + out.error + "</p>";
      timeline.innerHTML = ""; temps.innerHTML = "";
      return;
    }

    var rel = relative(out.firstStart);
    verdict.innerHTML = "Start the first job at <strong>" + R.fmtTime(out.firstStart) + "</strong>" +
      (rel ? " <span class=\"rel\">" + rel + "</span>" : "") +
      ". Everything's ready to serve at <strong>" + R.fmtTime(out.serveTime) + "</strong>.";

    // Warnings.
    var w = "";
    out.ovenConflicts.forEach(function (c) {
      var names = c.dishes.map(function (d) { return d.name + " (" + d.tempF + "F)"; }).join(" and ");
      w += '<p class="warn">Oven clash from ' + R.fmtTime(c.from) + " to " + R.fmtTime(c.to) +
        ": " + names + " want different heat. Cook them in turn, use two shelves, or finish the hotter dish while the joint rests.</p>";
    });
    if (out.restWindow && out.restWindow.suggest.length) {
      w += '<p class="hint">The oven is free of the ' + out.restWindow.meat.toLowerCase() + " from " +
        R.fmtTime(out.restWindow.from) + " (" + R.fmtDuration(out.restWindow.minutes) + " while it rests). " +
        out.restWindow.suggest.join(" and ") + " then " +
        (out.restWindow.suggest.length > 1 ? "have" : "has") + " the oven to themselves, so turn it up.</p>";
    }
    warnings.innerHTML = w;

    // Timeline.
    timeline.innerHTML = "";
    out.steps.forEach(function (s) {
      var li = document.createElement("li");
      li.className = "step step-" + s.kind;
      li.innerHTML = '<span class="step-time">' + R.fmtTime(s.at) + '</span><span class="step-text">' + s.text + "</span>";
      timeline.appendChild(li);
    });

    // Pull temperatures.
    temps.innerHTML = "";
    out.items.filter(function (p) { return p.pull; }).forEach(function (p) {
      var c = Math.round((p.pull.f - 32) * 5 / 9);
      var div = document.createElement("div");
      div.className = "temp-card" + (p.pull.belowSafe ? " below" : "");
      div.innerHTML = "<strong>" + p.name + "</strong><span>pull at " + p.pull.f + "F / " + c + "C</span>" +
        (p.pull.belowSafe ? '<em>below the USDA safe 145F, a cook\'s choice</em>' : "");
      temps.appendChild(div);
    });

    if (window.Ding) window.Ding.context("done"), window.Ding.react("done");
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function copyPlan() {
    var items = collectItems();
    var out = R.planMeal({ serveTime: serveEl.value, items: items, hotRoom: hotRoomEl && hotRoomEl.checked });
    if (!out.ok) return;
    var lines = ["Readyby plan - serve at " + R.fmtTime(out.serveTime), ""];
    out.steps.forEach(function (s) { lines.push(R.fmtTime(s.at) + "  " + s.text); });
    var t = lines.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { if (window.Ding) window.Ding.react("copied"); });
    }
  }

  function example() {
    serveEl.value = "18:00";
    meatSel = "chicken"; meatWeight = "4";
    sides = { "roast-potatoes": true, "roast-veg": true, "gravy": true };
    renderChips();
    renderMeatDetail();
    if (window.Ding) window.Ding.context("meat");
    plan();
  }

  document.getElementById("go").addEventListener("click", plan);
  document.getElementById("example").addEventListener("click", example);
  document.getElementById("copy").addEventListener("click", copyPlan);

  renderChips();
  renderMeatDetail();
})();
