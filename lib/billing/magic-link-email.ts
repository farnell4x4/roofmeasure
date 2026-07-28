import { Resend } from "resend";
import { getRuntimeEnvSnapshot } from "@/lib/config/env";

type SendMagicLinkEmailResult = {
  previewUrl?: string;
};

export async function sendMagicLinkEmail(email: string, magicLinkUrl: string): Promise<SendMagicLinkEmailResult> {
  const env = await getRuntimeEnvSnapshot();

  if (!env.RESEND_API_KEY || !env.MAGIC_LINK_FROM_EMAIL) {
    if (process.env.NODE_ENV !== "production") {
      return { previewUrl: magicLinkUrl };
    }
    throw new Error("Missing RESEND_API_KEY or MAGIC_LINK_FROM_EMAIL for production magic-link delivery.");
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.MAGIC_LINK_FROM_NAME
      ? `${env.MAGIC_LINK_FROM_NAME} <${env.MAGIC_LINK_FROM_EMAIL}>`
      : env.MAGIC_LINK_FROM_EMAIL,
    to: email,
    subject: "Sign in to Roof Tape Measure",
    text: `Sign in to Roof Tape Measure: ${magicLinkUrl}\n\nThis link expires in 15 minutes.`,
    html: `<p>Sign in to Roof Tape Measure:</p><p><a href="${magicLinkUrl}">Sign in</a></p><p>This link expires in 15 minutes.</p>`,
  });

  if (error) {
    throw new Error(`Magic-link email delivery failed: ${error.message}`);
  }

  return {};
}
