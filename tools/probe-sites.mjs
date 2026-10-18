// Reachability probe for candidate shops, run FROM A GITHUB RUNNER — the same
// egress the collector has. A site that answers a Turkish home line can still
// refuse Azure ranges (Mavi, Twist), so this is the only test that counts.
//
//   node tools/probe-sites.mjs  ->  probe-results.json + a table in the log
//
// No secrets, no proxy: plain requests with Chrome-like headers.
const C = {
  US: {
    hollister: "https://www.hollisterco.com/shop/us", abercrombie: "https://www.abercrombie.com/shop/us",
    aritzia: "https://www.aritzia.com/us/en", nike: "https://www.nike.com/w/sale-3yaep", sephora: "https://www.sephora.com",
    ulta: "https://www.ulta.com", lululemon: "https://shop.lululemon.com", skims: "https://skims.com",
    gap: "https://www.gap.com", oldnavy: "https://oldnavy.gap.com", bananarepublic: "https://bananarepublic.gap.com",
    athleta: "https://athleta.gap.com", nordstrom: "https://www.nordstrom.com", nordstromrack: "https://www.nordstromrack.com",
    brandymelville: "https://us.brandymelville.com", americaneagle: "https://www.ae.com/us/en", rarebeauty: "https://www.rarebeauty.com",
    aloyoga: "https://www.aloyoga.com", princesspolly: "https://us.princesspolly.com", stevemadden: "https://www.stevemadden.com",
    victoriassecret: "https://www.victoriassecret.com/us/", coach: "https://www.coach.com", katespade: "https://www.katespade.com",
    adidas: "https://www.adidas.com/us", newbalance: "https://www.newbalance.com", on: "https://www.on.com/en-us",
    hoka: "https://www.hoka.com/en/us/", ugg: "https://www.ugg.com", michaelkors: "https://www.michaelkors.com",
    uniqlo: "https://www.uniqlo.com/us/en/", glossier: "https://www.glossier.com", mejuri: "https://mejuri.com",
    edikted: "https://edikted.com", quince: "https://www.quince.com", macys: "https://www.macys.com",
    jcrew: "https://www.jcrew.com", madewell: "https://www.madewell.com", elf: "https://www.elfcosmetics.com",
    fashionnova: "https://www.fashionnova.com", reformation: "https://www.thereformation.com", target: "https://www.target.com",
    urbanoutfitters: "https://www.urbanoutfitters.com", freepeople: "https://www.freepeople.com", anthropologie: "https://www.anthropologie.com",
    pacsun: "https://www.pacsun.com", revolve: "https://www.revolve.com", everlane: "https://www.everlane.com",
    whitefox: "https://whitefoxboutique.com", pandora: "https://us.pandora.net", hm: "https://www2.hm.com/en_us/index.html",
    zara: "https://www.zara.com/us/", mango: "https://shop.mango.com/us",
  },
  CA: {
    aritzia: "https://www.aritzia.com/en/home", lululemon: "https://shop.lululemon.com/en-ca", gap: "https://www.gapcanada.ca",
    oldnavy: "https://oldnavy.gapcanada.ca", sephora: "https://www.sephora.com/ca/en", garage: "https://www.garageclothing.com/ca",
    dynamite: "https://www.dynamiteclothing.com/ca", nike: "https://www.nike.com/ca/w/sale-3yaep", reitmans: "https://www.reitmans.com",
    simons: "https://www.simons.ca/en", abercrombie: "https://www.abercrombie.com/shop/ca", hollister: "https://www.hollisterco.com/shop/ca",
    uniqlo: "https://www.uniqlo.com/ca/en/", americaneagle: "https://www.ae.com/ca/en", lasenza: "https://www.lasenza.com",
    ardene: "https://www.ardene.com", aldo: "https://www.aldoshoes.com/ca/en", callitspring: "https://www.callitspring.com/ca/en",
    knix: "https://knix.ca", mejuri: "https://mejuri.com/ca/en", victoriassecret: "https://www.victoriassecret.com/ca/",
    skims: "https://skims.com/en-ca", suzyshier: "https://www.suzyshier.com", pandora: "https://ca.pandora.net/en/",
    lavieenrose: "https://www.lavieenrose.com/en", adidas: "https://www.adidas.ca/en", newbalance: "https://www.newbalance.ca/en/",
    urbanoutfitters: "https://www.urbanoutfitters.com/en-ca/", ssense: "https://www.ssense.com/en-ca", joefresh: "https://www.joefresh.com/ca",
    roots: "https://www.roots.com/ca/en/", laura: "https://www.laura.ca", frankandoak: "https://www.frankandoak.com",
    sportchek: "https://www.sportchek.ca", shoppers: "https://beauty.shoppersdrugmart.ca", freepeople: "https://www.freepeople.com/ca/",
  },
  GB: {
    next: "https://www.next.co.uk", marksandspencer: "https://www.marksandspencer.com", nike: "https://www.nike.com/gb/w/sale-3yaep",
    uniqlo: "https://www.uniqlo.com/uk/en/", boots: "https://www.boots.com", boohoo: "https://www.boohoo.com",
    prettylittlething: "https://www.prettylittlething.com", karenmillen: "https://www.karenmillen.com", cos: "https://www.cos.com/en-gb",
    arket: "https://www.arket.com/en-gb", stories: "https://www.stories.com/en-gb", weekday: "https://www.weekday.com/en-gb",
    lookfantastic: "https://www.lookfantastic.com", cultbeauty: "https://www.cultbeauty.co.uk", riverisland: "https://www.riverisland.com",
    adidas: "https://www.adidas.co.uk", jdsports: "https://www.jdsports.co.uk", whistles: "https://www.whistles.com",
    hobbs: "https://www.hobbs.com", phaseeight: "https://www.phase-eight.com", ohpolly: "https://www.ohpolly.com",
    neverfullydressed: "https://www.neverfullydressed.co.uk", nobodyschild: "https://www.nobodyschild.com", newlook: "https://www.newlook.com/uk",
    topshop: "https://www.topshop.com", reiss: "https://www.reiss.com", sweatybetty: "https://www.sweatybetty.com",
    gymshark: "https://uk.gymshark.com", lululemon: "https://www.lululemon.co.uk/en-gb", skims: "https://skims.com/en-gb",
    spacenk: "https://www.spacenk.com/uk", mintvelvet: "https://www.mintvelvet.co.uk", tedbaker: "https://www.tedbaker.com/uk",
    boden: "https://www.boden.co.uk", lounge: "https://loungeunderwear.com", missoma: "https://www.missoma.com",
    pandora: "https://uk.pandora.net/en/", superdrug: "https://www.superdrug.com", accessorize: "https://uk.accessorize.com",
    monsoon: "https://uk.monsoon.co.uk", charlottetilbury: "https://www.charlottetilbury.com/uk", dune: "https://www.dunelondon.com",
    kurtgeiger: "https://www.kurtgeiger.com", abercrombie: "https://www.abercrombie.com/shop/uk", asos: "https://www.asos.com",
    astridmiyu: "https://www.astridandmiyu.com", primark: "https://www.primark.com/en-gb",
  },
  AE: {
    aivi: "https://www.6thstreet.com/uae-en", victoriassecret: "https://www.victoriassecret.ae/en/", bathandbodyworks: "https://www.bathandbodyworks.ae/en/",
    americaneagle: "https://www.americaneagle.ae/en/", namshi: "https://www.namshi.com/uae-en/", centrepoint: "https://www.centrepointstores.com/ae/en/",
    max: "https://www.maxfashion.com/ae/en/", splash: "https://www.splashfashions.com/ae/en/", styli: "https://stylishop.com/ae/en/",
    sephora: "https://www.sephora.ae/en", levelshoes: "https://www.levelshoes.com", goldenscent: "https://www.goldenscent.com/en/",
    vperfumes: "https://vperfumes.com", swissarabian: "https://www.swissarabian.com", arabianoud: "https://www.arabianoud.com/ae-en",
    faces: "https://www.faces.ae/en", nike: "https://www.nike.ae/en/", ounass: "https://www.ounass.ae",
    modanisa: "https://www.modanisa.com/en/", ajmal: "https://www.ajmal.com", adidas: "https://www.adidas.ae/en",
    damas: "https://www.damasjewellery.com", bloomingdales: "https://bloomingdales.ae", charlottetilbury: "https://www.charlottetilbury.com/ae",
    nyx: "https://www.nyxcosmetics.ae/en/", bodyshop: "https://www.thebodyshop.ae/en/", boots: "https://www.boots.ae/en/",
    charleskeith: "https://www.charleskeith.com/ae", aldo: "https://www.aldoshoes.ae", hm: "https://ae.hm.com/en/",
    mango: "https://shop.mango.com/ae", zara: "https://www.zara.com/ae/",
  },
  SA: {
    aivi: "https://www.6thstreet.com/saudi-en", victoriassecret: "https://www.victoriassecret.sa/en/", bathandbodyworks: "https://www.bathandbodyworks.sa/en/",
    americaneagle: "https://www.americaneagle.sa/en/", namshi: "https://www.namshi.com/saudi-en/", centrepoint: "https://www.centrepointstores.com/sa/en/",
    max: "https://www.maxfashion.com/sa/en/", styli: "https://stylishop.com/sa/en/", sephora: "https://www.sephora.sa/en",
    levelshoes: "https://www.levelshoes.com/sa-en", goldenscent: "https://www.goldenscent.com/sa-en/", nahdi: "https://www.nahdionline.com/en-sa",
    arabianoud: "https://www.arabianoud.com/sa-en", faces: "https://www.faces.sa/en", nike: "https://www.nike.sa/en/",
    ounass: "https://www.ounass.sa", leem: "https://www.leem.com/en-sa", lattafa: "https://lattafa-usa.com",
    alqurashi: "https://www.asqgrp.com", hm: "https://sa.hm.com/en/", adidas: "https://www.adidas.sa/en",
  },
  AU: {
    cottonon: "https://cottonon.com/AU/", kookai: "https://www.kookai.com.au", princesspolly: "https://au.princesspolly.com",
    glassons: "https://www.glassons.com/au", dissh: "https://www.dissh.com.au", uniqlo: "https://www.uniqlo.com/au/en/",
    mecca: "https://www.mecca.com/en-au/", meshki: "https://www.meshki.com.au", whitefox: "https://whitefoxboutique.com.au",
    lululemon: "https://www.lululemon.com.au/en-au/", countryroad: "https://www.countryroad.com.au", mimco: "https://www.mimco.com.au",
    hellomolly: "https://www.hellomolly.com.au", showpo: "https://www.showpo.com", nike: "https://www.nike.com/au/w/sale-3yaep",
    seafolly: "https://seafolly.com", tigerlily: "https://www.tigerlily.com.au", beginningboutique: "https://www.beginningboutique.com.au",
    peppermayo: "https://www.peppermayo.com", forevernew: "https://www.forevernew.com.au", decjuba: "https://www.decjuba.com.au",
    seed: "https://www.seedheritage.com", universalstore: "https://www.universalstore.com", lornajane: "https://www.lornajane.com.au",
    penation: "https://www.pe-nation.com", sephora: "https://www.sephora.com.au", adorebeauty: "https://www.adorebeauty.com.au",
    lovisa: "https://www.lovisa.com.au", tonybianco: "https://www.tonybianco.com", billini: "https://www.billini.com",
    wittner: "https://www.wittner.com.au", sportsgirl: "https://www.sportsgirl.com.au", portmans: "https://www.portmans.com.au",
    bonds: "https://www.bonds.com.au", jdsports: "https://www.jd-sports.com.au", theiconic: "https://www.theiconic.com.au",
    hm: "https://www2.hm.com/en_au/index.html", spell: "https://au.spell.co",
  },
  CH: {
    zalando: "https://www.zalando.ch", dosenbach: "https://www.dosenbach.ch", ochsnershoes: "https://www.ochsnershoes.ch",
    canda: "https://www.c-and-a.com/ch/de/shop", manor: "https://www.manor.ch", aboutyou: "https://www.aboutyou.ch",
    nike: "https://www.nike.com/ch/w/sale-3yaep", notino: "https://www.notino.ch", impo: "https://www.impo.ch",
    douglas: "https://www.douglas.ch", sephora: "https://www.sephora.ch", only: "https://www.only.com/de-ch",
    veromoda: "https://www.veromoda.com/de-ch", calzedonia: "https://www.calzedonia.com/ch", intimissimi: "https://www.intimissimi.com/ch",
    on: "https://www.on.com/de-ch", pandora: "https://ch.pandora.net/de/", cos: "https://www.cos.com/de-ch",
    arket: "https://www.arket.com/de-ch", tallyweijl: "https://www.tally-weijl.com/de_CH", chicoree: "https://www.chicoree.ch",
    snipes: "https://www.snipes.ch", calida: "https://www.calida.com/ch-de", triumph: "https://de-ch.triumph.com",
    ochsnersport: "https://www.ochsnersport.ch", decathlon: "https://www.decathlon.ch", globus: "https://www.globus.ch",
  },
  NO: {
    ginatricot: "https://www.ginatricot.com/no", boozt: "https://www.boozt.com/no", zalando: "https://www.zalando.no",
    kicks: "https://www.kicks.no", only: "https://www.only.com/nb-no", veromoda: "https://www.veromoda.com/nb-no",
    lyko: "https://lyko.com/nb", blivakker: "https://www.blivakker.no", kappahl: "https://www.kappahl.com/nb-no",
    cubus: "https://cubus.com/nb-no", bikbok: "https://bikbok.com/nb-no", carlings: "https://www.carlings.com/nb-no",
    lindex: "https://www.lindex.com/no", vita: "https://www.vita.no", nike: "https://www.nike.com/no/w/sale-3yaep",
    nelly: "https://nelly.com/no", weekday: "https://www.weekday.com/nb-no", cos: "https://www.cos.com/nb-no",
    arket: "https://www.arket.com/nb-no", bubbleroom: "https://www.bubbleroom.no", pandora: "https://no.pandora.net/nb/",
    nakd: "https://www.na-kd.com/no", fredrikoglouisa: "https://www.fredrikoglouisa.no", gullfunn: "https://www.gullfunn.no",
    xxl: "https://www.xxl.no", ellos: "https://www.ellos.no", rains: "https://www.rains.com/no",
  },
  TR: {
    fashfed: "https://www.fashfed.com", flo: "https://www.flo.com.tr", instreet: "https://www.instreet.com.tr",
    yvesrocher: "https://www.yvesrocher.com.tr", calzedonia: "https://www.calzedonia.com/tr", intimissimi: "https://www.intimissimi.com/tr",
    falconeri: "https://www.falconeri.com/tr", skechers: "https://www.skechers.com.tr", uspolo: "https://tr.uspoloassn.com",
    gap: "https://www.gap.com.tr", kiko: "https://www.kikocosmetics.com/tr-tr", mac: "https://www.maccosmetics.com.tr",
    flormar: "https://www.flormar.com.tr", sneaksup: "https://www.sneaksup.com", suwen: "https://www.suwen.com.tr",
    bathandbodyworks: "https://www.bathandbodyworks.com.tr", haydigiy: "https://www.haydigiy.com", oxxo: "https://www.oxxo.com.tr",
    converse: "https://www.converse.com.tr", gant: "https://www.gant.com.tr", atasay: "https://www.atasay.com",
    elifstil: "https://www.elifstil.com", note: "https://www.notecosmetique.com", loccitane: "https://tr.loccitane.com",
    bluemint: "https://www.bluemint.com", dagi: "https://www.dagi.com.tr", jimmykey: "https://www.jimmykey.com",
    machka: "https://www.machka.com.tr", intersport: "https://www.intersport.com.tr", sportive: "https://www.sportive.com.tr",
    desa: "https://www.desa.com.tr", adidas: "https://www.adidas.com.tr", cacharel: "https://www.cacharel.com.tr",
    yargici: "https://www.yargici.com", hotic: "https://www.hotic.com.tr", benetton: "https://tr.benetton.com",
    tommy: "https://tr.tommy.com", calvinklein: "https://www.calvinklein.com.tr", mavi: "https://www.mavi.com", twist: "https://www.twist.com.tr",
  },
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HEADERS = { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9,tr;q=0.8" };

async function hit(url) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    const h = r.headers;
    const wall = /captcha|cf-chl|challenge-platform|_Incapsula|px-captcha|datadome|Access Denied|Pardon Our Interruption/i.test(body.slice(0, 20000));
    return {
      status: r.status, ms: Date.now() - t, bytes: body.length, final: r.url,
      edge: h.get("cf-ray") ? "cloudflare" : h.get("x-akamai-transformed") || /akamai/i.test(h.get("server") ?? "") ? "akamai" : h.get("x-datadome") ? "datadome" : h.get("server") ?? "",
      shopify: /cdn\.shopify\.com|Shopify\.theme/.test(body), wall, json: body.trimStart().startsWith("{"),
      head: body.slice(0, 200),
    };
  } catch (e) {
    return { status: 0, ms: Date.now() - t, error: String(e?.cause?.code ?? e?.name ?? e).slice(0, 60) };
  }
}

// Request mode: `-f requests='[{"url":"…","method":"POST","headers":{…},"body":"…"}]'`
// for endpoints that need a method, headers or a body (GraphQL, app APIs).
if (process.env.PROBE_REQUESTS?.trim()) {
  const fs1 = await import("node:fs");
  const list = JSON.parse(process.env.PROBE_REQUESTS);
  const res = [];
  for (const q of list) {
    const t = Date.now();
    try {
      const r = await fetch(q.url, { method: q.method ?? "GET", headers: { "user-agent": UA, ...(q.headers ?? {}) }, body: q.body, signal: AbortSignal.timeout(20000) });
      const body = await r.text();
      const line = { url: q.url, method: q.method ?? "GET", status: r.status, bytes: body.length, ms: Date.now() - t, edge: r.headers.get("cf-ray") ? "cloudflare" : r.headers.get("server") ?? "", head: body.slice(0, Math.min(Number(q.headBytes) || 200, 400000)) };
      res.push(line);
      console.log(`${String(r.status).padEnd(4)} ${String(body.length).padStart(8)}B ${line.method} ${line.edge} ${q.url}`);
      console.log("     " + line.head.replace(/\s+/g, " "));
    } catch (e) {
      res.push({ url: q.url, error: String(e?.cause?.code ?? e?.name ?? e) });
      console.log(`ERR  ${q.url} ${String(e?.cause?.code ?? e?.name ?? e)}`);
    }
  }
  fs1.writeFileSync("probe-results.json", JSON.stringify(res, null, 2));
  process.exit(0);
}

// Ad-hoc mode: `gh workflow run probe.yml -f urls="https://a https://b"` — GET
// each URL from the runner and print status, size and the first bytes, so a
// data endpoint (not just a home page) can be judged from GitHub's egress.
if (process.env.PROBE_URLS?.trim()) {
  const fs0 = await import("node:fs");
  const res = [];
  for (const url of process.env.PROBE_URLS.trim().split(/\s+/)) {
    const h = await hit(url);
    res.push({ url, ...h });
    console.log(`${String(h.status).padEnd(4)} ${(h.bytes ?? 0).toString().padStart(8)}B ${h.wall ? "WALL " : ""}${h.edge ?? ""} ${url}${h.error ? "  " + h.error : ""}`);
    if (h.head) console.log("     " + h.head.replace(/\s+/g, " "));
  }
  fs0.writeFileSync("probe-results.json", JSON.stringify(res, null, 2));
  process.exit(0);
}

const jobs = [];
for (const [cc, shops] of Object.entries(C)) for (const [name, url] of Object.entries(shops)) jobs.push({ cc, name, url });
const out = [];
let i = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  while (i < jobs.length) {
    const j = jobs[i++];
    const home = await hit(j.url);
    const origin = (() => { try { return new URL(home.final || j.url).origin; } catch { return new URL(j.url).origin; } })();
    const sp = await hit(`${origin}/products.json?limit=1`);
    const shopifyFeed = sp.status === 200 && sp.json && /"products"\s*:\s*\[/.test(sp.head ?? "");
    out.push({ ...j, home, shopifyFeed, feedStatus: sp.status });
  }
}));
out.sort((a, b) => a.cc.localeCompare(b.cc) || a.name.localeCompare(b.name));
const fs = await import("node:fs");
fs.writeFileSync("probe-results.json", JSON.stringify(out, null, 2));
for (const r of out) {
  const h = r.home;
  const ok = h.status === 200 && !h.wall;
  console.log([r.cc, r.name.padEnd(18), String(h.status).padEnd(4), ok ? "OK  " : "FAIL", r.shopifyFeed ? "SHOPIFY-FEED" : "            ", (h.edge || "").padEnd(12), h.wall ? "WALL" : "", h.error ?? "", `${h.bytes ?? 0}B`].join(" "));
}
const byCc = {};
for (const r of out) { byCc[r.cc] ??= [0, 0]; byCc[r.cc][1]++; if (r.home.status === 200 && !r.home.wall) byCc[r.cc][0]++; }
console.log("\nreachable / tested:", JSON.stringify(byCc));
