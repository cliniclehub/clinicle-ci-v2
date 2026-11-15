"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowLeft, MessageCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

const initialMessages: Message[] = [
  { sender: "support", text: "Hi! How can we help you today?" },
]

type Message = {
  sender: "user" | "support"
  text: string
}

export default function ChatWithUsPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState("")

  const handleBack = () => router.back()

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    setMessages([...messages, { sender: "user", text: input }])
    setInput("")
    // Simulate support reply
    setTimeout(() => {
      setMessages(msgs => [...msgs, { sender: "support", text: "Thank you for your message! Our team will reply shortly." }])
    }, 1200)
  }

  return (
    <div className="min-h-[90vh] flex flex-col items-center justify-center bg-background py-8 px-4">
      {/* Back Button */}
      <div className="w-full max-w-md mb-4">
        <Button variant="ghost" onClick={handleBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
      <div className="w-full h-full max-w-md bg-card text-card-foreground rounded-xl shadow-lg p-6 flex flex-col">
        <div className="flex items-center gap-2 mb-2">
          <MessageCircle className="h-6 w-6 text-blue-500" />
          <h1 className="text-2xl font-bold dark:text-white">Chat With Us</h1>
        </div>
        <p className="text-muted-foreground mb-4">Our support team is here to help. Start a conversation below.</p>
        {/* Chat UI */}
        <div className="flex-1 overflow-y-auto mb-4 max-h-96 bg-muted rounded p-3 space-y-2">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={
                msg.sender === "user"
                  ? "text-right"
                  : "text-left"
              }
            >
              <span
                className={
                  msg.sender === "user"
                    ? "inline-block bg-blue-500 text-white px-3 py-1 rounded-lg max-w-xs"
                    : "inline-block bg-muted text-foreground px-3 py-1 rounded-lg max-w-xs"
                }
                aria-label={msg.sender === "user" ? "Your message" : "Support message"}
              >
                {msg.text}
              </span>
            </div>
          ))}
        </div>
        <form onSubmit={handleSend} className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1"
            aria-label="Type your message"
            required
          />
          <Button type="submit" disabled={!input.trim()}>
            Send
          </Button>
        </form>
      </div>
    </div>
  )
} 