"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ArrowLeft, ChevronDown, ChevronRight, HelpCircle, Mail, Search } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

export default function HelpPage() {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")
  const [openSections, setOpenSections] = useState<string[]>([])

  const handleBack = () => {
    router.back()
  }

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) =>
      prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId]
    )
  }

  const faqData = [
    {
      id: "getting-started",
      title: "Getting Started",
      icon: HelpCircle,
      items: [
        {
          question: "What is this platform?",
          answer:
            "This is a multi-tenant application framework for organizations. Features available to you depend on your role and how your organization has configured the Service. Product-specific help will be added as business modules are introduced.",
        },
        {
          question: "What are the different user roles?",
          answer:
            "The framework currently supports Users (standard account access), Organization Admins (organization settings, users, and communications), and Super Admins (platform-wide organization and configuration management).",
        },
        {
          question: "How do I update my profile or settings?",
          answer:
            "Open the profile menu at the bottom of the sidebar to access Profile, Settings, theme preferences, and sign out. Organization-level branding and legal content are managed by Organization Admins under Administrations.",
        },
      ],
    },
    {
      id: "accounts-access",
      title: "Accounts & Access",
      icon: HelpCircle,
      items: [
        {
          question: "How do I reset my password?",
          answer:
            "On the login page, use Forgot Password, enter your email address, and follow the reset link sent to your inbox. If you do not receive an email, check spam or contact your organization administrator.",
        },
        {
          question: "Who can manage users in my organization?",
          answer:
            "Organization Admins can view and manage organization users. Super Admins can manage users across organizations from the platform administration area.",
        },
        {
          question: "Where are Terms of Use and Privacy Policy?",
          answer:
            "Public Terms of Use and Privacy Policy pages are linked from login, registration, and site footers. Organization Admins can customize the text under Legal in organization settings.",
        },
      ],
    },
    {
      id: "technical-support",
      title: "Technical Support",
      icon: HelpCircle,
      items: [
        {
          question: "What browsers are supported?",
          answer:
            "Use a current version of Chrome, Firefox, Safari, or Edge. Older browsers may not support all features.",
        },
        {
          question: "Why can't I upload files?",
          answer:
            "Confirm the file type is allowed and the size is within your organization's limits. If uploads still fail, contact your organization administrator or support.",
        },
        {
          question: "Why is this Help page mostly a placeholder?",
          answer:
            "Help content is intentionally general while the framework is established. As product features are built on top of the platform, topic-specific guides will be added here.",
        },
      ],
    },
  ]

  const filteredFaq = faqData
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.answer.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((section) => section.items.length > 0)

  return (
    <div className="container mx-auto py-8 sm:px-4 px-2 max-w-4xl">
      <div className="mb-6">
        <Button variant="ghost" onClick={handleBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>

      <div className="mb-8 text-left">
        <h1 className="text-4xl font-bold mb-4 dark:text-white">Help Center</h1>
        <p className="text-lg text-muted-foreground mb-6">
          General guidance for using this platform. Feature-specific help will expand as your
          organization&apos;s product modules are added.
        </p>

        <div className="relative max-w-md ml-0 mb-8">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <input
            type="text"
            placeholder="Search for help..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="space-y-6">
        {filteredFaq.map((section) => (
          <Card key={section.id} className="mx-1 rounded-lg">
            <CardHeader>
              <div className="flex items-center gap-3">
                <section.icon className="h-6 w-6 text-blue-500" />
                <CardTitle className="text-xl">{section.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {section.items.map((item, index) => (
                  <Collapsible
                    key={index}
                    open={openSections.includes(`${section.id}-${index}`)}
                    onOpenChange={() => toggleSection(`${section.id}-${index}`)}
                  >
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className="w-full justify-between p-4 pr-8 pl-2 h-auto text-left hover:bg-muted"
                      >
                        <span className="font-medium dark:text-white whitespace-normal break-words">
                          {item.question}
                        </span>
                        {openSections.includes(`${section.id}-${index}`) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="px-4 pb-4">
                      <p className="text-muted-foreground leading-relaxed">{item.answer}</p>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-8">
        <CardHeader className="flex flex-col items-center text-center gap-2">
          <Mail className="h-8 w-8 text-blue-500 mb-1" />
          <CardTitle className="text-xl font-bold">Still Need Help?</CardTitle>
          <CardDescription className="mt-2">
            If you couldn&apos;t find what you need,{" "}
            <a href="/contact" className="text-blue-500 underline">
              contact us
            </a>{" "}
            or reach out to your organization administrator.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>

      <div className="mt-6 pt-6 border-t border-border">
        <Button variant="ghost" onClick={handleBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
    </div>
  )
}
