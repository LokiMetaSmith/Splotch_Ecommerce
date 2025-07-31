const serverUrl = 'http://localhost:3000';

const imageUpload = document.getElementById('imageUpload');
const marginSlider = document.getElementById('marginSlider');
const quantityInput = document.getElementById('quantityInput');
const addToOrderBtn = document.getElementById('addToOrderBtn');
const cartDiv = document.getElementById('cart');
const emailInput = document.getElementById('emailInput');
const loginBtn = document.getElementById('loginBtn');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let image = null;
let margin = 10;
let cart = [];

imageUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        handleFile(file);
    }
});

async function handleFile(file) {
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
}

window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
        if (item.kind === 'file') {
            const file = item.getAsFile();
            handleFile(file);
        }
    }
});

marginSlider.addEventListener('input', (e) => {
    margin = parseInt(e.target.value, 10);
    drawImage();
});

canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvas.classList.add('border-dashed', 'border-2', 'border-blue-500');
});

canvas.addEventListener('dragleave', (e) => {
    e.preventDefault();
    canvas.classList.remove('border-dashed', 'border-2', 'border-blue-500');
});

canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    canvas.classList.remove('border-dashed', 'border-2', 'border-blue-500');

    const file = e.dataTransfer.files[0];
    if (file) {
        handleFile(file);
    }
});

addToOrderBtn.addEventListener('click', () => {
    if (!image) {
        return;
    }

    const sticker = {
        image: image.src,
        quantity: parseInt(quantityInput.value, 10),
        margin: margin,
    };

    cart.push(sticker);
    displayCart();
});

loginBtn.addEventListener('click', async () => {
    const email = emailInput.value;

    if (!email) {
        return;
    }

    try {
        const response = await fetch(`${serverUrl}/api/auth/magic-login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email }),
        });

        const data = await response.json();

        if (data.success) {
            alert(data.message);
        } else {
            console.error('Error sending magic link:', data.error);
        }
    } catch (error) {
        console.error('Error sending magic link:', error);
    }
});

function displayCart() {
    cartDiv.innerHTML = '';

    if (cart.length === 0) {
        cartDiv.innerHTML = '<p>Your cart is empty.</p>';
        return;
    }

    cart.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('flex', 'justify-between', 'items-center', 'mb-2');
        itemDiv.innerHTML = `
            <img src="${item.image}" class="w-16 h-16 object-cover">
            <span>Quantity: ${item.quantity}</span>
            <button data-index="${index}" class="remove-from-cart px-2 py-1 bg-red-500 text-white rounded-md hover:bg-red-600">&times;</button>
        `;
        cartDiv.appendChild(itemDiv);
    });

    const removeButtons = document.querySelectorAll('.remove-from-cart');
    removeButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const index = e.target.dataset.index;
            cart.splice(index, 1);
            displayCart();
        });
    });
}

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
