// Ding, the kitchen timer in the corner. Ding's eyes follow your pointer (or the
// box you're typing in on a phone), blinks now and then, gives a tip for the step
// you're on when tapped, grins and its hand spins when a plan comes out, looks
// worried when something's missing, and rings its bell if you tap it five times
// fast. Everything Ding says goes through the bubble's live region, so a screen
// reader hears it too.
(function () {
  "use strict";
  var btn = document.getElementById("ding");
  var bubble = document.getElementById("ding-bubble");
  var dock = document.getElementById("ding-dock");
  var hide = document.getElementById("ding-hide");
  if (!btn) {
    window.Ding = { context: function () {}, react: function () {}, say: function () {} };
    return;
  }

  var still = matchMedia("(prefers-reduced-motion: reduce)");
  var baseMood = "idle", tipKey = "start";
  var bubbleTimer = null, tapTimes = [], tipIndex = {};

  var TIPS = {
    start: [
      "Hi, I'm Ding! Set the time you want to eat, then pick what's cooking.",
      "Choose a centrepiece first. Pop in its weight and I'll time it.",
      "Not sure? Tap Try a Sunday roast and I'll fill one in."
    ],
    meat: [
      "The weight sets the roasting time, so get it as close as you can.",
      "Beef and lamb let you pick how pink you like it. That changes the time.",
      "I plan the joint to come out early and rest, then get carved as you serve."
    ],
    done: [
      "Work down the list from the top. The first job is the one with the earliest time.",
      "Check the joint with a thermometer at the temperature I named. That's the real test.",
      "Tap Copy the plan and stick it on the fridge."
    ],
    worried: [
      "Pick at least one dish and I'll build the timeline.",
      "Add a weight for the joint so I can time it."
    ]
  };

  function setMood(m) { btn.setAttribute("data-mood", m); }

  function say(text, ms) {
    if (dock.classList.contains("tucked")) return;
    bubble.textContent = text;
    bubble.classList.remove("pop");
    void bubble.offsetWidth;
    bubble.classList.add("pop");
    clearTimeout(bubbleTimer);
    if (ms) bubbleTimer = setTimeout(function () { bubble.textContent = ""; }, ms);
  }

  function tip() {
    var list = TIPS[tipKey] || TIPS.start;
    var i = (tipIndex[tipKey] || 0) % list.length;
    tipIndex[tipKey] = i + 1;
    say(list[i], 7000);
  }

  // Eyes follow the pointer a little.
  var eyes = btn.querySelectorAll(".d-eye");
  function look(x, y) {
    if (still.matches) return;
    var r = btn.getBoundingClientRect();
    var dx = Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / r.width));
    var dy = Math.max(-1, Math.min(1, (y - (r.top + r.height / 2)) / r.height));
    eyes.forEach(function (e) { e.style.transform = "translate(" + (dx * 2.2) + "px," + (dy * 2.2) + "px)"; });
  }
  window.addEventListener("pointermove", function (e) { look(e.clientX, e.clientY); });
  document.addEventListener("focusin", function (e) {
    if (!e.target.getBoundingClientRect) return;
    var t = e.target.getBoundingClientRect();
    look(t.left + t.width / 2, t.top + t.height / 2);
  });

  // Blink.
  function blink() {
    if (still.matches) return;
    btn.classList.add("blink");
    setTimeout(function () { btn.classList.remove("blink"); }, 150);
  }
  setInterval(function () { if (Math.random() < 0.5) blink(); }, 4200);

  // A quick ring: the bell jiggles and three sound lines ping out.
  function ring() {
    if (still.matches) return;
    btn.classList.add("ringing");
    setTimeout(function () { btn.classList.remove("ringing"); }, 900);
  }

  btn.addEventListener("click", function () {
    tapTimes.push(Date.now());
    tapTimes = tapTimes.filter(function (t) { return Date.now() - t < 1500; });
    if (tapTimes.length >= 5) { tapTimes = []; ring(); say("Ding ding! Dinner's up.", 3000); return; }
    tip();
    if (!still.matches) { btn.classList.add("hop"); setTimeout(function () { btn.classList.remove("hop"); }, 500); }
  });

  hide.addEventListener("click", function () {
    dock.classList.toggle("tucked");
    hide.textContent = dock.classList.contains("tucked") ? "show" : "tuck";
  });

  window.Ding = {
    // Set the step Ding talks about and its resting mood.
    context: function (key) {
      tipKey = key;
      baseMood = key === "worried" ? "worried" : (key === "done" ? "happy" : "idle");
      setMood(baseMood);
    },
    // A one-off reaction to something that just happened.
    react: function (key) {
      if (key === "done") { setMood("happy"); say("Here's your timeline. Start with the top job.", 6000); ring(); }
      else if (key === "worried") { setMood("worried"); }
      else if (key === "thinking") { setMood("thinking"); setTimeout(function () { setMood(baseMood); }, 1000); }
      else if (key === "copied") { say("Copied. Stick it on the fridge.", 3500); }
    },
    say: say
  };

  setTimeout(function () { if (!dock.classList.contains("tucked")) tip(); }, 900);
})();
