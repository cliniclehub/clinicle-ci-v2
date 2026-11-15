"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { toast } from "sonner"
import { useState } from "react"

export function StorageServiceSettings() {
  const [provider, setProvider] = useState("s3")
  const [isLoading, setIsLoading] = useState(false)

  const handleSave = async () => {
    setIsLoading(true)
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setIsLoading(false)
    toast.success("Storage service settings have been updated successfully.")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage Service Configuration</CardTitle>
        <CardDescription>
          Configure the storage service used for user uploads, branding assets, and media files.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="storage-provider">Storage Service Provider</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger id="storage-provider">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="s3">Amazon S3</SelectItem>
              <SelectItem value="gcs">Google Cloud Storage</SelectItem>
              <SelectItem value="azure">Azure Blob Storage</SelectItem>
              <SelectItem value="cloudinary">Cloudinary</SelectItem>
              <SelectItem value="local">Local Storage</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Tabs value={provider} className="mt-6">
          <TabsContent value="s3" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="s3-access-key">Access Key</Label>
              <Input id="s3-access-key" placeholder="Enter your AWS Access Key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s3-secret-key">Secret Key</Label>
              <Input id="s3-secret-key" type="password" placeholder="Enter your AWS Secret Key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s3-region">Region</Label>
              <Input id="s3-region" placeholder="us-east-1" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s3-bucket">Bucket Name</Label>
              <Input id="s3-bucket" placeholder="your-bucket-name" />
            </div>
          </TabsContent>

          <TabsContent value="gcs" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gcs-project-id">Project ID</Label>
              <Input id="gcs-project-id" placeholder="Enter your GCP Project ID" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gcs-credentials">Service Account Key (JSON)</Label>
              <Input id="gcs-credentials" type="file" accept=".json" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gcs-bucket">Bucket Name</Label>
              <Input id="gcs-bucket" placeholder="your-bucket-name" />
            </div>
          </TabsContent>

          <TabsContent value="azure" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="azure-connection-string">Connection String</Label>
              <Input
                id="azure-connection-string"
                type="password"
                placeholder="Enter your Azure Storage Connection String"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="azure-container">Container Name</Label>
              <Input id="azure-container" placeholder="your-container-name" />
            </div>
          </TabsContent>

          <TabsContent value="cloudinary" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cloudinary-cloud-name">Cloud Name</Label>
              <Input id="cloudinary-cloud-name" placeholder="Enter your Cloudinary Cloud Name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cloudinary-api-key">API Key</Label>
              <Input id="cloudinary-api-key" placeholder="Enter your Cloudinary API Key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cloudinary-api-secret">API Secret</Label>
              <Input id="cloudinary-api-secret" type="password" placeholder="Enter your Cloudinary API Secret" />
            </div>
          </TabsContent>

          <TabsContent value="local" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="local-path">Storage Path</Label>
              <Input id="local-path" placeholder="/var/www/uploads" />
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="local-public" />
              <Label htmlFor="local-public">Publicly Accessible</Label>
            </div>
            <p className="text-sm text-amber-500">
              Note: Local storage is not recommended for production environments. Consider using a cloud storage
              provider for better scalability and reliability.
            </p>
          </TabsContent>
        </Tabs>

        <div className="space-y-4 pt-4 border-t">
          <div className="space-y-2">
            <Label>File Type Restrictions</Label>
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Switch id="file-images" defaultChecked />
                <Label htmlFor="file-images">Images (jpg, png, gif, webp)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="file-documents" defaultChecked />
                <Label htmlFor="file-documents">Documents (pdf, doc, docx, ppt, pptx)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="file-audio" defaultChecked />
                <Label htmlFor="file-audio">Audio (mp3, wav, ogg)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="file-video" defaultChecked />
                <Label htmlFor="file-video">Video (mp4, webm)</Label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="max-file-size">Maximum File Size (MB)</Label>
            <Input id="max-file-size" type="number" defaultValue="50" min="1" max="1000" />
          </div>

          <div className="flex items-center space-x-2">
            <Switch id="storage-cdn" defaultChecked />
            <div className="grid gap-1.5 leading-none">
              <Label htmlFor="storage-cdn">CDN Delivery</Label>
              <p className="text-sm text-muted-foreground">
                Enable CDN delivery for faster content loading across different regions.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button onClick={handleSave} disabled={isLoading}>
          {isLoading ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  )
}
