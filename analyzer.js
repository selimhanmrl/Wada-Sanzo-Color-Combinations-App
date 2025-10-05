// Your Gemini API key - Replace with your actual API key
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY';
const API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1/models/gemini-pro-vision:generateContent';

let colorData = null;
let combinationsData = null;

// Load color data when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Load both color data files
        const [colorResponse, combinationsResponse] = await Promise.all([
            fetch('color.json'),
            fetch('combined_colors.json')
        ]);

        if (!colorResponse.ok || !combinationsResponse.ok) {
            throw new Error('Failed to load color data');
        }

        colorData = await colorResponse.json();
        combinationsData = await combinationsResponse.json();
    } catch (error) {
        console.error('Error loading color data:', error);
        showError('Failed to load color data. Please refresh the page.');
    }

    setupImageUpload();
});

function setupImageUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const imageInput = document.getElementById('imageInput');
    const previewImage = document.getElementById('previewImage');
    const analyzeButton = document.getElementById('analyzeButton');
    const uploadPlaceholder = document.querySelector('.upload-placeholder');

    // Handle click on upload area
    uploadArea.addEventListener('click', () => {
        imageInput.click();
    });

    // Handle drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#333';
        uploadArea.style.background = '#f0f0f0';
    });

    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#ccc';
        uploadArea.style.background = 'transparent';
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#ccc';
        uploadArea.style.background = 'transparent';
        
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleImageFile(file);
        }
    });

    // Handle file input change
    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleImageFile(file);
        }
    });

    // Handle analyze button click
    analyzeButton.addEventListener('click', async () => {
        const file = imageInput.files[0];
        if (file) {
            await analyzeImage(file);
        }
    });

    function handleImageFile(file) {
        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImage.src = e.target.result;
            previewImage.classList.remove('hidden');
            uploadPlaceholder.classList.add('hidden');
            analyzeButton.disabled = false;
        };
        reader.readAsDataURL(file);
    }
}

async function analyzeImage(file) {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const resultsSection = document.getElementById('resultsSection');
    
    try {
        loadingIndicator.classList.remove('hidden');
        
        // Convert image to base64
        const base64Image = await getBase64(file);
        
        // Prepare the request to Gemini API
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GEMINI_API_KEY}`
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: "Analyze this image and identify the main colors present in the clothing. For each color, provide the closest matching color from the Wada Sanzo color palette."
                    }, {
                        inline_data: {
                            mime_type: file.type,
                            data: base64Image.split(',')[1]
                        }
                    }]
                }]
            })
        });

        if (!response.ok) {
            throw new Error('Failed to analyze image');
        }

        const data = await response.json();
        const colors = parseGeminiResponse(data);
        
        // Display results
        displayResults(colors);
        resultsSection.classList.remove('hidden');
        
    } catch (error) {
        console.error('Error analyzing image:', error);
        showError('Failed to analyze image. Please try again.');
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}

function parseGeminiResponse(data) {
    // This is a placeholder implementation
    // You'll need to adapt this based on the actual response format from Gemini
    const detectedColors = [];
    
    // Parse the response and match with your color palette
    // This is where you'll implement the color matching logic
    
    return detectedColors;
}

function displayResults(detectedColors) {
    const detectedColorsList = document.getElementById('detectedColorsList');
    const recommendationsList = document.getElementById('recommendationsList');
    
    // Clear previous results
    detectedColorsList.innerHTML = '';
    recommendationsList.innerHTML = '';
    
    // Display detected colors
    detectedColors.forEach(color => {
        const colorItem = document.createElement('div');
        colorItem.className = 'color-item';
        colorItem.innerHTML = `
            <div class="color-swatch" style="background-color: ${color.hex}"></div>
            <div class="color-info">
                <div class="color-name">${color.name}</div>
                <div class="color-value">${color.hex}</div>
            </div>
        `;
        detectedColorsList.appendChild(colorItem);
    });
    
    // Find and display recommended combinations
    const recommendations = findColorCombinations(detectedColors);
    recommendations.forEach(combo => {
        const comboElement = createCombinationElement(combo);
        recommendationsList.appendChild(comboElement);
    });
}

function findColorCombinations(detectedColors) {
    // Implement the logic to find matching combinations from your dataset
    // This should return an array of compatible color combinations
    return [];
}

function createCombinationElement(combination) {
    // Create and return a DOM element for a color combination
    // Similar to the main page but adapted for recommendations
    const element = document.createElement('div');
    // Add combination display logic here
    return element;
}

function getBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function showError(message) {
    // Implement error display logic
    alert(message); // Replace with better error UI
}

// Add a navigation link to the main page
const mainPageNav = document.createElement('a');
mainPageNav.href = 'index.html';
mainPageNav.className = 'back-to-main';
mainPageNav.textContent = '← Back to Color Combinations';
document.querySelector('header').appendChild(mainPageNav);