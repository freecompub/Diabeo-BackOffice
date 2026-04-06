declare module "clamscan" {
  interface ClamScanOptions {
    removeInfected?: boolean
    quarantineInfected?: boolean
    debugMode?: boolean
    clamdscan?: {
      socket?: string
      host?: string
      port?: number
      timeout?: number
      active?: boolean
    }
    clamscan?: {
      path?: string
      active?: boolean
    }
  }

  interface ScanResult {
    isInfected: boolean | null
    file: string
    viruses?: string[]
  }

  class NodeClam {
    init(options: ClamScanOptions): Promise<NodeClam>
    scanFile(filePath: string): Promise<ScanResult>
  }

  export default NodeClam
}
