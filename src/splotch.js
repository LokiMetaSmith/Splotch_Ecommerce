const serverUrl = 'http://localhost:3000';

const imageUpload = document.getElementById('imageUpload');
const marginSlider = document.getElementById('marginSlider');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let image = null;
let margin = 10;

imageUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) {
        return;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
        const response = await fetch(`${serverUrl}/api/upload-image`, {
            method: 'POST',
            body: formData,
        });

        const data = await response.json();

        if (data.success) {
            image = new Image();
            image.src = `${serverUrl}${data.filePath}`;
            image.onload = () => {
                drawImage();
            };
        } else {
            console.error('Error uploading image:', data.error);
        }
    } catch (error) {
        console.error('Error uploading image:', error);
    }
});

marginSlider.addEventListener('input', (e) => {
    margin = parseInt(e.target.value, 10);
    drawImage();
});

function drawImage() {
    if (!image) {
        return;
    }

    canvas.width = image.width + margin * 2;
    canvas.height = image.height + margin * 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, margin, margin);

    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.strokeRect(margin, margin, image.width, image.height);
}
