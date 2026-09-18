import { Resend } from 'resend'

/** Sem RESEND_API_KEY (dev), só loga o email no console. */
export async function sendMail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.log(`[mail] para: ${to} | ${subject}\n${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`)
    return
  }
  const { error } = await new Resend(key).emails.send({ from: process.env.MAIL_FROM ?? 'Task Gaming <onboarding@resend.dev>', to, subject, html })
  if (error) throw new Error(`Falha ao enviar email: ${error.message}`)
}
