import { z } from 'zod';
import { isBlockedByProxy, platformFetch } from '../platform/fetch.js';
import { getSecret } from '../platform/secrets.js';
import { defineTool } from '../platform/tool.js';

// Example of calling an external API: wttr.in is listed under `network` and EXAMPLE_API_KEY
// under `secrets` in platform-plugin.yaml. (wttr.in needs no key; a real service would.)
export default defineTool({
  name: 'get_weather',
  title: '날씨 조회',
  description: '도시 이름을 받아 현재 날씨를 알려줘요.',
  input: { city: z.string().min(1).describe('도시 이름(예: 서울, Busan)') },
  run: async ({ city }) => {
    const apiKey = getSecret('EXAMPLE_API_KEY');
    const lang = getSecret('EXAMPLE_LANG', { required: false }) ?? 'ko';
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=${encodeURIComponent(lang)}`;
    let res;
    try {
      // A real service would check this key; it is sent here only to show where it goes.
      res = await platformFetch(url, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      if (isBlockedByProxy(err)) {
        throw new Error('허용되지 않은 도메인이라 플랫폼이 막았어요. platform-plugin.yaml의 network에 도메인을 추가하세요.');
      }
      throw new Error(`날씨 서비스에 연결하지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new Error(`날씨 서비스가 오류를 돌려줬어요 (HTTP ${res.status}).`);
    const data = (await res.json()) as {
      current_condition?: { temp_C?: string; FeelsLikeC?: string; humidity?: string; weatherDesc?: { value: string }[]; [k: string]: unknown }[];
    };
    const now = data.current_condition?.[0];
    if (!now) throw new Error('날씨 정보를 찾지 못했어요.');
    const desc = (now[`lang_${lang}`] as { value: string }[] | undefined)?.[0]?.value ?? now.weatherDesc?.[0]?.value ?? '';
    return { city, 기온: `${now.temp_C}°C`, 체감: `${now.FeelsLikeC}°C`, 습도: `${now.humidity}%`, 날씨: desc };
  },
});
