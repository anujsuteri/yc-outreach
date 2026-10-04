import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const MAILTO_RE = /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ttf|eot)$|sentry|wixpress|example\.|@2x|u00|domain\.com|email\.com|yourdomain|yourcompany|test@|sample@|demo@/i;
const SLUG_RE = /^[a-z0-9-]{1,100}$/;
const BATCH_RE = /^(Winter|Spring|Summer|Fall) \d{4}$|^[WSFX]\d{2}$|^IK12$|^Unspecified$/;
const MAX_SLUGS = 10;
const SEASON = { Winter: 1, Spring: 2, Summer: 3, Fall: 4 };

let _algolia = null;

async function fetchText(url, timeoutMs = 7000, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...(options.headers || {})
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function getAlgolia() {
  if (!_algolia) {
    const page = await fetchText("https://www.ycombinator.com/companies", 8000);
    const m = page ? page.match(/window\.AlgoliaOpts\s*=\s*\{"app":"(\w+)","key":"([^"]+)"\}/) : null;
    if (!m) {
      throw new Error("Could not read YC's company search");
    }
    _algolia = { app: m[1], key: m[2] };
  }
  return _algolia;
}

async function queryAlgolia(params) {
  const { app, key } = await getAlgolia();
  const body = JSON.stringify({ params: new URLSearchParams(params).toString() });
  const hosts = [
    `${app}-dsn.algolia.net`,
    `${app}-1.algolianet.com`,
    `${app}-2.algolianet.com`
  ];
  for (const host of hosts) {
    try {
      const res = await fetch(`https://${host}/1/indexes/YCCompany_production/query`, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "X-Algolia-Application-Id": app,
          "X-Algolia-API-Key": key,
          "Content-Type": "application/json"
        },
        body,
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // try next host
    }
  }
  _algolia = null;
  throw new Error("YC company search failed");
}

function batchKey(b) {
  const p = b.split(' ');
  return (p.length === 2 && /^\d+$/.test(p[1])) ? [parseInt(p[1], 10), SEASON[p[0]] || 0] : [0, 0];
}

async function batches() {
  const data = await queryAlgolia({
    hitsPerPage: 0,
    facets: JSON.stringify(["batch"]),
    maxValuesPerFacet: 1000
  });
  const facets = data.facets?.batch || {};
  const entries = Object.entries(facets);
  entries.sort((a, b) => {
    const [yearA, seasonA] = batchKey(a[0]);
    const [yearB, seasonB] = batchKey(b[0]);
    if (yearB !== yearA) return yearB - yearA;
    return seasonB - seasonA;
  });
  return entries.map(([batch, count]) => ({ batch, count }));
}

async function companies(batch) {
  const hits = [];
  let page = 0;
  while (true) {
    const res = await queryAlgolia({
      hitsPerPage: 1000,
      page,
      facetFilters: JSON.stringify([[`batch:${batch}`]])
    });
    hits.push(...(res.hits || []));
    page++;
    if (page >= (res.nbPages || 0)) break;
  }
  return hits.map(h => ({
    name: h.name,
    slug: h.slug,
    batch: h.batch,
    website: h.website || "",
    one_liner: h.one_liner || "",
    industry: h.subindustry || "",
    team_size: h.team_size,
    small_logo_url: h.small_logo_url || "",
    launched_at: h.launched_at || 0
  }));
}

function domainOf(website) {
  if (!website) return "";
  try {
    const raw = website.includes("//") ? website : `https://${website}`;
    const host = new URL(raw).hostname || "";
    return host.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function asciiName(s) {
  if (!s) return [];
  return s
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function unescapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

async function getMxInfo(domain) {
  if (!domain) return { active: false, exchanges: [] };
  try {
    const records = await dns.resolveMx(domain);
    if (!records || !records.length) return { active: false, exchanges: [] };
    const exchanges = records.map(r => r.exchange.toLowerCase());
    return { active: true, exchanges: exchanges.slice(0, 3) };
  } catch {
    return { active: false, exchanges: [] };
  }
}

async function siteEmails(website, domain, maxPaths = 3) {
  if (!website || !domain) return [];
  const found = new Set();
  const base = website.replace(/\/+$/, "");
  const paths = ["", "/contact", "/about", "/team", "/privacy", "/terms", "/.well-known/security.txt"].slice(0, maxPaths);
  
  await Promise.allSettled(paths.map(async (path) => {
    try {
      const body = await fetchText(base + path, 3500);
      if (!body) return;
      let decoded = "";
      try {
        decoded = decodeURIComponent(body.replace(/%(?![0-9a-fA-F]{2})/g, "%25"));
      } catch {
        decoded = body;
      }
      decoded = unescapeHtml(decoded);
      
      // Match mailto links first (highest fidelity real emails)
      let mMatch;
      while ((mMatch = MAILTO_RE.exec(decoded)) !== null) {
        const mail = mMatch[1].toLowerCase().trim().replace(/^\.+|\.+$/g, "");
        const parts = mail.split("@");
        if (parts.length === 2) {
          const host = parts[1];
          if (!BAD_EMAIL.test(mail) && (host === domain || host.endsWith("." + domain))) {
            found.add(mail);
          }
        }
      }
      MAILTO_RE.lastIndex = 0;

      // Match all general emails in document
      const matches = decoded.match(EMAIL_RE) || [];
      for (let e of matches) {
        e = e.toLowerCase().trim().replace(/^\.+|\.+$/g, "");
        const parts = e.split("@");
        if (parts.length === 2) {
          const host = parts[1];
          if (!BAD_EMAIL.test(e) && (host === domain || host.endsWith("." + domain))) {
            found.add(e);
          }
        }
      }
    } catch {
      // Ignore individual page fetch errors
    }
  }));

  return Array.from(found).sort();
}

function guesses(fullName, domain) {
  const parts = asciiName(fullName);
  if (!parts.length || !domain) return [];
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const list = [`${first}@${domain}`];
  if (last) {
    list.push(`${first}.${last}@${domain}`);
    list.push(`${first[0]}${last}@${domain}`);
    list.push(`${first}${last}@${domain}`);
  }
  return list;
}

async function resolves(domain) {
  try {
    await dns.lookup(domain);
    return true;
  } catch {
    return false;
  }
}

async function foundersForSlug(slug) {
  const page = await fetchText(`https://www.ycombinator.com/companies/${slug}`, 8000);
  const m = page ? page.match(/data-page="([^"]*)"/) : null;
  if (!m) {
    return { slug, error: "Couldn't load this company's YC page" };
  }
  let company;
  try {
    const unescaped = unescapeHtml(m[1]);
    const parsed = JSON.parse(unescaped);
    company = parsed.props?.company || {};
  } catch {
    return { slug, error: "Couldn't parse company data" };
  }

  const website = company.website || "";
  const domain = domainOf(website);

  let emails = [];
  let mxInfo = { active: false, exchanges: [] };
  let dnsOk = false;

  if (domain) {
    const [emailsRes, mxRes, dnsRes] = await Promise.allSettled([
      siteEmails(website, domain, 3),
      getMxInfo(domain),
      resolves(domain)
    ]);
    if (emailsRes.status === "fulfilled") emails = emailsRes.value;
    if (mxRes.status === "fulfilled") mxInfo = mxRes.value;
    if (dnsRes.status === "fulfilled") dnsOk = dnsRes.value;
  }

  // Extract common startup company inbox emails if present in site_emails
  const teamInboxes = emails.filter(e => {
    const prefix = e.split("@")[0].toLowerCase();
    return ["founders", "founder", "hello", "contact", "team", "hi", "press", "careers", "jobs", "info"].includes(prefix);
  });

  const founders = (company.founders || []).map(f => {
    const name = f.full_name || "";
    const parts = asciiName(name);
    const first = parts.length ? parts[0] : "";
    
    // Check if any site email explicitly matches this founder's first name
    const emailsFound = emails.filter(e => first && e.split("@")[0].startsWith(first));
    
    // Guesses backed by active MX validation
    const emailGuesses = (mxInfo.active || dnsOk) ? guesses(name, domain) : [];
    
    return {
      name,
      title: f.title || "Founder",
      avatar_thumb_url: f.avatar_thumb_url ? unescapeHtml(f.avatar_thumb_url) : "",
      bio: f.founder_bio || "",
      linkedin: f.linkedin_url || "",
      twitter: f.twitter_url || "",
      has_email: Boolean(f.has_email),
      emails_found: emailsFound,
      email_guesses: emailGuesses
    };
  });

  return {
    slug,
    name: company.name || slug,
    logo_url: company.small_logo_url || company.logo_url || "",
    location: company.location || "",
    year_founded: company.year_founded || null,
    team_size: company.team_size || null,
    website,
    domain,
    linkedin: company.linkedin_url || "",
    twitter: company.twitter_url || "",
    github: company.github_url || "",
    mx_info: mxInfo,
    team_inboxes: teamInboxes,
    site_emails: emails,
    founders
  };
}

const app = express();
const port = 3000;

app.use(express.static(__dirname));

app.get('/api/yc', async (req, res) => {
  const action = req.query.action;
  try {
    if (action === 'batches') {
      const data = await batches();
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
      return res.json(data);
    }
    if (action === 'companies') {
      const batch = req.query.batch;
      if (!batch || !BATCH_RE.test(batch)) {
        return res.status(400).json({ error: 'Invalid batch' });
      }
      const data = await companies(batch);
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      return res.json(data);
    }
    if (action === 'founders') {
      const slugsParam = req.query.slugs || '';
      const slugs = slugsParam.split(',').map(s => s.trim()).filter(Boolean);
      if (!slugs.length || slugs.length > MAX_SLUGS || !slugs.every(s => SLUG_RE.test(s))) {
        return res.status(400).json({ error: `Pass 1-${MAX_SLUGS} valid slugs` });
      }
      const results = await Promise.all(slugs.map(foundersForSlug));
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
      return res.json(results);
    }
    if (action === 'deep_scan') {
      const website = req.query.website || '';
      const domain = req.query.domain || domainOf(website);
      if (!domain) {
        return res.status(400).json({ error: 'Valid website or domain required' });
      }
      const [emails, mxInfo] = await Promise.all([
        siteEmails(website, domain, 7),
        getMxInfo(domain)
      ]);
      return res.json({
        domain,
        website,
        mx_info: mxInfo,
        site_emails: emails
      });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Upstream error' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});
