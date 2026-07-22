import type { ImageProject } from "@/types/image-projects"

export function createImageProject(file: File, width: number, height: number): ImageProject {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(), schemaVersion: 1, kind: "image",
    name: file.name.replace(/\.[^.]+$/, "") || "Roof photo",
    image: file, imageName: file.name, imageWidth: width, imageHeight: height,
    segments: [], pendingLineStart: null, planes: [], singlePitch: "6/12",
    createdAt: now, updatedAt: now, lastOpenedAt: now,
  }
}

export function readImageDimensions(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    const source = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(source)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(source)
      reject(new Error("The selected file could not be read as an image."))
    }
    image.src = source
  })
}
