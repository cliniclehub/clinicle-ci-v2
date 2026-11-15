import { getAuthTokenData } from "@/lib/utils/auth-server-helper";
import { createServerLogger } from "@/lib/utils/logger-server";


const logger = createServerLogger("EmailSenderHelper")
export class EmailSenderHelper {

  static async sendEmail({ to, subject, content, sendToMe }: { to: string; subject: string; content: string; sendToMe?: boolean }) {
    const methodLogger = logger.forMethod("sendEmail")
    methodLogger.info("Sending email", { to, subject, content, sendToMe })


    // TODO: Implement actual API call
    return { success: true }
  }
  static async sendTestEmail({ to, subject, content }: { to: string; subject: string; content: string }) {
    // TODO: Implement actual API call
    console.log("Sending test email", { to, subject, content })
    const tokenData = await getAuthTokenData()
    const toAddress = tokenData?.email || ""



    await EmailSenderHelper.sendEmail({ to: toAddress || "", subject, content })
    return { success: true }
  }
} 