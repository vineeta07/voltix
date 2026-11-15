"use client";

import { useEffect, useState } from "react";

// Driver-facing strings only. Operator screens stay in English.
const STR = {
  en: {
    title: "My charging", lead: "Plug in, tell us when you need it, and we find your slot.",
    vehicle: "Your vehicle", plug: "Which plug?", battery: "Battery now", readyBy: "Ready by", today: "today", tomorrow: "tomorrow",
    plugged: "I've plugged in", busy: "In use", offline: "Offline", free: "Free",
    startsAt: "Starts at", readyAt: "ready by", chargingNow: "Charging now", doneBy: "Should finish by", waiting: "Waiting for your slot",
    whyWait: "Your slot is chosen so everyone on this site is charged in time and the building stays within its limit.",
    chargeNow: "Charge now instead", stop: "Stop and unplug", delivered: "delivered", of: "of", done: "Charged",
    doneBody: "Your vehicle is ready. You can unplug.", another: "Start another charge", rate: "How was it?",
    atRisk: "We cannot be ready by your time", atRiskBody: "The earliest we can finish is", accept: "Accept new time", keep: "Charge now anyway",
    consentTitle: "Before your first charge", consentAgree: "I agree", paused: "Paused briefly", cost: "Cost so far", solar: "from solar",
    overrideNote: "You are in control. Charging now is always allowed; it is logged.", noPlugs: "No plugs are set up at this site yet.",
    simulated: "This plug is simulated.", cancelled: "Stopped",
  },
  hi: {
    title: "मेरी चार्जिंग", lead: "प्लग लगाइए, बताइए कब चाहिए, हम आपका समय तय करेंगे।",
    vehicle: "आपकी गाड़ी", plug: "कौन सा प्लग?", battery: "अभी बैटरी", readyBy: "कब तक तैयार चाहिए", today: "आज", tomorrow: "कल",
    plugged: "मैंने प्लग लगा दिया", busy: "व्यस्त", offline: "बंद", free: "खाली",
    startsAt: "शुरू होगी", readyAt: "तैयार", chargingNow: "चार्ज हो रही है", doneBy: "पूरी होगी", waiting: "आपकी बारी का इंतज़ार",
    whyWait: "आपका समय ऐसे चुना गया है कि सबकी गाड़ी समय पर चार्ज हो और बिल्डिंग की सीमा पार न हो।",
    chargeNow: "अभी चार्ज करें", stop: "रोकें और प्लग निकालें", delivered: "मिली", of: "में से", done: "चार्ज पूरी",
    doneBody: "आपकी गाड़ी तैयार है। प्लग निकाल सकते हैं।", another: "नई चार्जिंग शुरू करें", rate: "कैसा रहा?",
    atRisk: "आपके समय तक तैयार नहीं हो पाएगी", atRiskBody: "सबसे जल्दी पूरी होगी", accept: "नया समय मानें", keep: "फिर भी अभी चार्ज करें",
    consentTitle: "पहली चार्जिंग से पहले", consentAgree: "मैं सहमत हूँ", paused: "थोड़ी देर रुकी है", cost: "अब तक खर्च", solar: "सोलर से",
    overrideNote: "नियंत्रण आपके हाथ में है। अभी चार्ज करना हमेशा संभव है; इसे दर्ज किया जाता है।", noPlugs: "इस जगह अभी कोई प्लग नहीं लगा है।",
    simulated: "यह प्लग सिम्युलेटेड है।", cancelled: "रोक दी गई",
  },
} as const;

export type Lang = keyof typeof STR;
export type Strings = { [K in keyof (typeof STR)["en"]]: string };

export function useLang() {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    const saved = localStorage.getItem("voltix.lang");
    if (saved === "hi" || saved === "en") setLangState(saved);
  }, []);
  const setLang = (l: Lang) => {
    localStorage.setItem("voltix.lang", l);
    setLangState(l);
  };
  return { lang, setLang, t: STR[lang] as Strings };
}
