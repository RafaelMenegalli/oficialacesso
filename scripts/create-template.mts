/**
 * npm run whatsapp:template
 *
 * Creates the MARKETING template in the WABA through Omni Z-API, or — if a
 * template with the same name + language already exists — just prints its
 * id and status (idempotent; Meta template names cannot be reused anyway).
 *
 * Endpoints (developer.omni.z-api.io):
 *   GET  /whatsapp/businesses/{wabaId}/templates
 *   POST /whatsapp/businesses/{wabaId}/templates
 */
import { describeError, env, omni } from "./_omni.mts";

interface Template {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
}

const wabaId = env("ZAPI_WABA_ID");
const name = env("WHATSAPP_TEMPLATE_NAME", "simpatia_acesso_imediato");
const language = env("WHATSAPP_TEMPLATE_LANG", "pt_BR");
const buttonUrl = env("NEXT_PUBLIC_VSL_URL", "https://oficialacesso.site/vsl");

async function findExisting(): Promise<Template | undefined> {
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ limit: "100" });
    if (after) query.set("after", after);
    const { status, body } = await omni(`/whatsapp/businesses/${encodeURIComponent(wabaId)}/templates?${query}`);
    if (status !== 200) throw new Error(`Listing templates failed: ${describeError(status, body)}`);
    const result = body as { data?: Template[]; paging?: { cursors?: { after?: string } } };
    const match = result.data?.find((t) => t.name === name && t.language === language);
    if (match) return match;
    after = result.paging?.cursors?.after;
    if (!after || !result.data?.length) return undefined;
  }
  return undefined;
}

const definition = {
  name,
  category: "MARKETING",
  language,
  parameter_format: "POSITIONAL",
  components: [
    {
      type: "BODY",
      text: "Oii, {{1}}! Tudo bem? Segue o link para assistir ao vídeo completo.",
      example: { body_text: [["Maria"]] },
    },
    { type: "FOOTER", text: "Equipe Sensitiva" },
    {
      type: "BUTTONS",
      // Static URL: no variable, so no button parameter at send time.
      buttons: [{ type: "URL", text: "Assistir agora", url: buttonUrl }],
    },
  ],
};

const existing = await findExisting();
if (existing) {
  console.log(`Template already exists: ${existing.name} (${existing.language})`);
  console.log(`  id: ${existing.id ?? "?"}  status: ${existing.status ?? "?"}  category: ${existing.category ?? "?"}`);
  process.exit(0);
}

console.log(`Creating template ${name} (${language}) → button ${buttonUrl}`);
const { status, body } = await omni(`/whatsapp/businesses/${encodeURIComponent(wabaId)}/templates`, {
  method: "POST",
  body: JSON.stringify(definition),
});
if (status !== 200 && status !== 201) {
  console.error(`Template creation failed: ${describeError(status, body)}`);
  process.exit(1);
}
const created = body as Template;
console.log(`Created. id: ${created.id ?? "?"}  status: ${created.status ?? "?"}  category: ${created.category ?? "?"}`);
console.log("Meta reviews it (usually minutes, up to 24 h). Re-run this command to see the current status.");
