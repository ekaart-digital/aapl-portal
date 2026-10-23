// Shrinks a chosen picture to a small square-bounded JPEG before it is sent, so
// photographs stay well under the server's size limit whatever the camera produced.

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

export function resizeImageToDataUrl(file, maxSize = 256, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !ACCEPTED.includes(file.type)) {
      reject(new Error('Choose a PNG, JPEG or WebP picture.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That picture could not be read.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That picture could not be opened.'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
