export const runtime = 'nodejs'

import { NextRequest } from 'next/server'

// GET /api/iframe-proxy?url=ENCODED_URL
// Simplified iframe proxy for Cloudflare Pages (Workers runtime).
//
// Fetches an iframe URL, strips ad scripts, injects popup blocker &
// auto-unmute scripts, then serves sanitized HTML.
// Kept lightweight for Workers 10ms CPU time limit.
//
// Strategy:
//   1. SERVER-SIDE: strip <script>/<iframe> tags whose src matches known ad networks
//   2. CSS INJECTION: hide common ad overlays with display:none !important
//   3. CLIENT-SIDE JS: window.open override, element removal via MutationObserver

// ── Known ad / tracker / popup network domains ──
const AD_DOMAIN_PATTERNS = [
  /adsterra/i, /propellerads/i, /propeller/i, /monetag/i,
  /popads/i, /popcash/i, /popunder/i, /clickadu/i, /hilltopads/i,
  /clicksgear/i, /recreativ/i, /profitable/i, /bidvertiser/i,
  /infolinks/i, /chitika/i, /kontera/i, /vibrantmedia/i,
  /highperformanceformat/i, /betterads/i, /pushnotification/i,
  /notification[\.-]?subscri/i, /subscri/i,
  /aclib/i, /acscdn/i, /adskeeper/i, /mgid/i, /revcontent/i,
  /taboola/i, /outbrain/i, /exoclick/i, /exosrv/i, /juicyads/i,
  /trafficjunky/i, /adspyglass/i, /adsupply/i,
  /histats/i, /statcounter/i, /googletagmanager/i, /googlesyndication/i,
  /doubleclick/i, /adservice\.google/i, /amazon-adsystem/i,
  /facebook\.net\/.*\/beacon/i, /connect\.facebook\.net\/.*\/sdk/i,
  /scorecardresearch/i, /quantserve/i, /comscore/i, /chartbeat/i,
  /hotjar/i, /clarity\.ms/i, /yandex\.ru\/metric/i, /mc\.yandex/i,
  /onesignal/i, /webpushr/i, /sendpulse/i, /izooto/i, /pushcrew/i,
  /adblocker/i, /adrecover/i, /adunblock/i, /blockadblock/i,
  /anti[\.-]?adblock/i,
  /hubeamily/i, /trovesleepit/i, /amplepreparation/i, /easyleaving/i,
  /fastlymoving/i, /readyfunction/i, /quicklyuseful/i, /suddenorigin/i,
  /differenttree/i, /possibleplayer/i, /novemberprice/i, /decembereffect/i,
]

function isAdDomain(url: string): boolean {
  if (!url) return false
  return AD_DOMAIN_PATTERNS.some((p) => p.test(url))
}

// ── Simplified CSS that hides common ad overlays ──
const AD_HIDE_CSS = `<style data-genztv-adblock="css">
div[id^="ad-"],div[id^="ads-"],div[id^="ad_"],div[id^="ads_"],
div[id$="-ad"],div[id$="-ads"],div[id*="bannerad" i],div[id*="adbanner" i],
div[id*="adcontainer" i],div[id*="adwrapper" i],div[id*="adoverlay" i],
div[class*="ad-banner" i],div[class*="ad-overlay" i],div[class*="ad-wrapper" i],
div[class*="ad-container" i],div[class*="ad_container" i],
div[class*="banner-ad" i],div[class*="overlay-ad" i],
div[class*="adcontainer" i],div[class*="adwrapper" i],div[class*="adoverlay" i],
div[class*="ad-slot" i],div[class*="adslot" i],div[class*="adsbox" i],
div[class*="ad-box" i],div[class*="adbox" i],div[class*="advert" i],
div[class*="advertisement" i],div[class*="promoted" i],div[class*="sponsor" i],
div[class*="popunder" i],div[id*="popunder" i],
div[class*="popup-ad" i],div[id*="popup-ad" i],div[class*="pop-ad" i],
div[class*="interstitial" i],div[id*="interstitial" i],
div[class*="social-bar" i],div[id*="social-bar" i],
div[class*="push-notification" i],div[id*="push-notification" i],
div[class*="clickadu" i],div[id*="clickadu" i],
div[class*="highperformanceformat" i],div[id*="highperformanceformat" i],
div[class*="betterads" i],div[id*="betterads" i],
div[class*="monetag" i],div[id*="monetag" i],
div[class*="adsterra" i],div[id*="adsterra" i],
div[class*="propeller" i],div[id*="propeller" i],
ins.adsbygoogle,ins.adslot,ins.ads,
div[id^="google_ads"],div[id^="div-gpt-ad"],iframe[id^="google_ads_"],
iframe[src*="googlesyndication" i],iframe[src*="doubleclick" i],
iframe[src*="amazon-adsystem" i],iframe[src*="adsterra" i],
iframe[src*="propellerads" i],iframe[src*="monetag" i],
iframe[src*="popads" i],iframe[src*="popcash" i],iframe[src*="clickadu" i],
div[class*="skip-ad" i],div[class*="skipad" i],
div[style*="position:fixed"][class*="ad" i],div[style*="position:fixed"][id*="ad" i]
{display:none!important;visibility:hidden!important;opacity:0!important;height:0!important;max-height:0!important;overflow:hidden!important;pointer-events:none!important;z-index:-1!important}
iframe#streamIframe,iframe[id*="streamIframe" i],iframe.stream-iframe
{display:block!important;opacity:1!important;visibility:visible!important}
</style>`

// ── Popup-blocker + auto-unmute script (injected client-side) ──
const POPUP_BLOCKER_JS = `<script data-genztv="popup-blocker">
(function(){
  // Block window.open popups
  window.open=function(){return null};
  // Block alert/prompt/confirm popups from ad scripts
  window.alert=function(){};
  window.prompt=function(){return null};
  window.confirm=function(){return false};
  // Intercept navigation to suspicious URLs
  var origLocation=window.location;
  // Auto-unmute: try to unmute any video element after a short delay
  setTimeout(function(){
    document.querySelectorAll('video').forEach(function(v){
      v.muted=false;
      try{v.play().catch(function(){})}catch(e){}
    });
  },1000);
  // Remove ad elements via MutationObserver
  var mo=new MutationObserver(function(ml){
    ml.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(!n||!n.tagName)return;
        var el=n;
        var id=el.id||'',cls=el.className||'';
        if(/ad-|ads-|ad_|ads_|banner|popup|popunder|overlay|interstitial/i.test(id+' '+cls)){
          el.remove();
        }
      });
    });
  });
  mo.observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) {
    return new Response(
      JSON.stringify({ error: 'Missing url parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const refererOverride = req.nextUrl.searchParams.get('referer')

  try {
    const parsedUrl = new URL(url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return new Response(
        JSON.stringify({ error: 'Invalid URL protocol' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const refererOrigin = refererOverride
      ? new URL(refererOverride).origin
      : parsedUrl.origin

    // Fetch the original HTML content
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        Referer: refererOrigin + '/',
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch: ${response.status}` }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    let html = await response.text()

    // ── Simplified HTML sanitization ──

    // 1. Neutralize aclib ad calls
    html = html.replace(/aclib\.runPop\s*\(\s*\{[^}]*\}\s*\)\s*;?/gi, '/* ad-blocked */')
    html = html.replace(
      /(<script\b[^>]*>)\s*(var\s+aclib|aclib\s*=)/gi,
      '$1/* ad-blocked */ var aclib = {runPop:function(){}};'
    )

    // 2. Strip ad/tracker scripts by domain
    html = html.replace(
      /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
      (match, src) => isAdDomain(src) ? '<!-- ad-script-blocked -->' : match
    )

    // 3. Strip ad iframes by domain
    html = html.replace(
      /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/iframe>/gi,
      (match, src) => isAdDomain(src) ? '<!-- ad-iframe-blocked -->' : match
    )
    html = html.replace(
      /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*\/?>/gi,
      (match, src) => isAdDomain(src) ? '<!-- ad-iframe-blocked -->' : match
    )

    // 4. Strip cfasync+async ad scripts (rotating CDN heuristic)
    html = html.replace(
      /<script\b[^>]*\bdata-cfasync=["']false["'][^>]*\basync\b[^>]*>\s*<\/script>/gi,
      '<!-- ad-cfasync-async-blocked -->'
    )
    html = html.replace(
      /<script\b[^>]*\basync\b[^>]*\bdata-cfasync=["']false["'][^>]*>\s*<\/script>/gi,
      '<!-- ad-cfasync-async-blocked -->'
    )

    // 5. Strip inline scripts that reference popup/popunder APIs
    html = html.replace(
      /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi,
      (match, body) => {
        if (/aclib\.runPop|popunder|popads|popcash|hilltopads|clickadu|adsterra|propeller/i.test(body)) {
          return '<!-- ad-inline-blocked -->'
        }
        // Strip frame-buster scripts (window.top/parent/self comparisons)
        if (
          /window\s*===?\s*window\.top/.test(body) ||
          /window\.top\s*===?\s*window\b/.test(body) ||
          /window\.top\s*!===?\s*window\b/.test(body) ||
          /\btop\s*!=\s*self\b/.test(body) ||
          /\bparent\s*!=\s*self\b/.test(body) ||
          /top\.location\s*=[^=]/.test(body) ||
          /parent\.location\s*=[^=]/.test(body) ||
          /window\.top\.location\s*=[^=]/.test(body) ||
          /window\.parent\.location\s*=[^=]/.test(body)
        ) {
          return '<!-- frame-buster-blocked -->'
        }
        return match
      }
    )

    // 6. Add <base> tag for relative URL resolution
    if (!html.includes('<base')) {
      const baseTag = `<base href="${parsedUrl.origin}/">`
      html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
    }

    // 7. Recursive iframe proxying (depth-limited to 3)
    const proxyDepth = Math.min(parseInt(req.nextUrl.searchParams.get('depth') || '0', 10) || 0, 3)
    if (proxyDepth < 3) {
      const ourOrigin = req.nextUrl.origin
      const decodeHtmlEntities = (s: string): string =>
        s.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
          .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#x27;/gi, "'")
          .replace(/&apos;/gi, "'")

      const rewriteIframe = (match: string, pre: string, src: string, post: string) => {
        const decodedSrc = decodeHtmlEntities(src)
        if (decodedSrc.includes('/api/iframe-proxy')) return match
        if (isAdDomain(decodedSrc)) return '<!-- ad-iframe-blocked-rewrite -->'
        if (!/^https?:\/\//i.test(decodedSrc)) return match
        const proxiedSrc = `${ourOrigin}/api/iframe-proxy?url=${encodeURIComponent(decodedSrc)}&depth=${proxyDepth + 1}`
        return `<iframe${pre} src="${proxiedSrc}"${post}>`
      }

      html = html.replace(
        /<iframe\b([^>]*)\bsrc=["'](https?:\/\/[^"']+)["']([^>]*)>[\s\S]*?<\/iframe>/gi,
        (m, pre, src, post) => rewriteIframe(m, pre, src, post)
      )
      html = html.replace(
        /<iframe\b([^>]*)\bsrc=["'](https?:\/\/[^"']+)["']([^>]*)\/?>/gi,
        (m, pre, src, post) => rewriteIframe(m, pre, src, post)
      )
    }

    // 8. Inject ad-blocking CSS and popup-blocker JS
    html = html.replace(/<head([^>]*)>/i, `<head$1>${AD_HIDE_CSS}${POPUP_BLOCKER_JS}`)

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: `Proxy error: ${message}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
