export type UploadedImageState = {
  file: File;
  url: string;
  name: string;
  width: number;
  height: number;
  size: number;
  mime: string;
};

export type ColorReference = {
  id: string;
  fileName: string;
  objectUrl: string;
  mimeType: string;
  size: number;
  createdAt: number;
};
