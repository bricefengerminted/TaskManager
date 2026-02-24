import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import sharp from 'sharp';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Upload to memory so we can process with sharp before writing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB raw (will be compressed)
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

const MAX_DIMENSION = 3840; // 4K max on longest edge

const router = Router();

// POST /api/uploads — upload one or more images, compressed to 4K JPEG
router.post('/', upload.array('images', 10), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const urls: string[] = [];

    for (const file of files) {
      const filename = `${uuidv4()}.jpg`;
      const outputPath = path.join(UPLOADS_DIR, filename);

      await sharp(file.buffer)
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(outputPath);

      urls.push(`/uploads/${filename}`);
    }

    return res.json({ urls });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to process images' });
  }
});

export default router;
