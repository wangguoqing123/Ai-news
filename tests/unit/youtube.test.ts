import test from "node:test";
import assert from "node:assert/strict";
import { decryptJson, encryptJson } from "../../lib/security/crypto";
import { fetchYouTubeSubscriptions, refreshYouTubeAccessToken } from "../../lib/youtube/api";

test("OAuth token encryption round-trips without plaintext storage", async () => {
  const encrypted = await encryptJson({ access_token:"access",refresh_token:"refresh" },"a-long-test-secret");
  assert.equal(encrypted.includes("access"),false);
  assert.deepEqual(await decryptJson(encrypted,"a-long-test-secret"),{ access_token:"access",refresh_token:"refresh" });
});

test("YouTube subscription import paginates and resolves uploads playlists", async () => {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url.toString());
    if (url.pathname.endsWith("/subscriptions") && !url.searchParams.get("pageToken")) return Response.json({
      items:[{ snippet:{ title:"Alpha",resourceId:{ channelId:"UC1" },thumbnails:{ default:{ url:"https://img/alpha" } } } }],
      nextPageToken:"next",
    });
    if (url.pathname.endsWith("/subscriptions")) return Response.json({ items:[{ snippet:{ title:"Beta",resourceId:{ channelId:"UC2" } } }] });
    return Response.json({ items:[
      { id:"UC1",snippet:{ title:"Alpha Official" },contentDetails:{ relatedPlaylists:{ uploads:"UU1" } } },
      { id:"UC2",snippet:{ title:"Beta" },contentDetails:{ relatedPlaylists:{ uploads:"UU2" } } },
    ] });
  }) as typeof fetch;
  const result = await fetchYouTubeSubscriptions("token",fetchImpl);
  assert.deepEqual(result.map((item) => [item.channelId,item.uploadsPlaylistId]),[["UC1","UU1"],["UC2","UU2"]]);
  assert.equal(requests.filter((url) => url.includes("/subscriptions")).length,2);
  assert.equal(requests.filter((url) => url.includes("/channels")).length,1);
});

test("YouTube token refresh retains the long-lived refresh token", async () => {
  const fetchImpl = (async () => Response.json({ access_token:"new-access",expires_in:3600,token_type:"Bearer" })) as typeof fetch;
  const result = await refreshYouTubeAccessToken({ refreshToken:"long-lived",clientId:"client",clientSecret:"secret",fetchImpl });
  assert.equal(result.access_token,"new-access");
  assert.equal(result.refresh_token,"long-lived");
  assert.ok((result.expires_at ?? 0) > Date.now());
});
