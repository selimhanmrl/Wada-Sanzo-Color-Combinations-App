
// Create global variables on the window object
const API_ENDPOINT = '/api/analyze-image';
window.colorData = null;
window.combinationsData = null;


let selectedClothesToKeep = [];
let selectedCombination = null;
let selectedStyle = 'casual'; // Default style preference

let allRecommendations = []; // To store the full, unfiltered list of combinations
let activeColorFilter = null;
// Load color data when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Track user visit when page loads
        try {
            await fetch('/api/track/visit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: 'anonymous' })
            });
        } catch (err) {
            console.error('Failed to track visit:', err);
        }

        // Load both color data files
        const [colorResponse, combinationsResponse] = await Promise.all([
            fetch('color.json'),
            fetch('combined_colors.json')
        ]);

        if (!colorResponse.ok || !combinationsResponse.ok) {
            throw new Error('Failed to load color data');
        }

        window.colorData = await colorResponse.json();
        window.combinationsData = await combinationsResponse.json();
        // Use safer logging
        if (window.console && window.console.log) {
            try {
                window.console.log('Loaded color data and combinations.');
            } catch (e) {
                // Silently handle any console restrictions
            }
        }
    } catch (error) {
        console.error('Error loading page data:', error);
        showError('Failed to load color data. Please refresh the page.');
    }

    setupImageUpload();
    setupStylePreferences();

    document.getElementById('generateButton').addEventListener('click', generateNewOutfit);

    // Listeners for closing the image popup
    const imagePopup = document.getElementById('imagePopupModal');
    const closePopupBtn = document.getElementById('closePopupBtn');
    const downloadButton = document.getElementById('downloadButton');

    closePopupBtn.addEventListener('click', () => imagePopup.classList.add('hidden'));
    imagePopup.addEventListener('click', (e) => {
        if (e.target === imagePopup) {
            imagePopup.classList.add('hidden');
        }
    });

      // Download button functionality
      downloadButton.addEventListener('click', downloadGeneratedImage);
      
      // Gallery button functionality
      const galleryButton = document.getElementById('galleryButton');
      const galleryModal = document.getElementById('galleryModal');
      const closeGalleryBtn = document.getElementById('closeGalleryBtn');
      
      if (galleryButton) {
          galleryButton.addEventListener('click', openGallery);
      }
      
      if (closeGalleryBtn) {
          closeGalleryBtn.addEventListener('click', closeGallery);
      }
      
      // Close gallery when clicking outside
      galleryModal.addEventListener('click', (e) => {
          if (e.target === galleryModal) {
              closeGallery();
          }
      });
      
      // Load gallery count on page load
      updateGalleryCount();
      
      // Check if we should auto-open the gallery (e.g., returning from search page)
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('openGallery') === 'true') {
          // Small delay to ensure everything is loaded
          setTimeout(() => {
              openGallery();
              // Clean up URL parameter
              window.history.replaceState({}, document.title, 'analyzer.html');
          }, 300);
      }
  });
  // Add global variables to track selections


// ... inside displayResults, when creating color items ...
// Add a checkbox to each colorItem
const checkbox = document.createElement('input');
checkbox.type = 'checkbox';
checkbox.value = color.clothing; // e.g., "shirt"
checkbox.addEventListener('change', (e) => {
    if (e.target.checked) {
        selectedClothesToKeep.push(e.target.value);
    } else {
        selectedClothesToKeep = selectedClothesToKeep.filter(item => item !== e.target.value);
    }
});
colorItem.prepend(checkbox);


// ... inside findColorCombinations, when creating combo elements ...
// Add a click listener to each comboElement
comboElement.addEventListener('click', () => {
    // Store the selected combination data
    selectedCombination = combination;
    
    // Add a 'selected' class for visual feedback
    document.querySelectorAll('.combination-pair').forEach(el => el.classList.remove('selected'));
    comboElement.classList.add('selected');

    // Enable the generate button
    document.getElementById('generateButton').disabled = false;
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

function setupStylePreferences() {
    const styleRadios = document.querySelectorAll('input[name="style"]');
    
    styleRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedStyle = e.target.value;
                console.log('Selected style:', selectedStyle);
                
                // Re-render combinations with new style preference
                renderCombinations();
            }
        });
    });
}

async function analyzeImage(file) {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const resultsSection = document.getElementById('resultsSection');
    
    try {
        // Validate file type and size
        if (!file.type.startsWith('image/')) {
            throw new Error('unsupported file type - Please upload a valid image file');
        }
        
        const maxSizeInMB = 10;
        if (file.size > maxSizeInMB * 1024 * 1024) {
            throw new Error(`Image file is too large. Maximum size allowed is ${maxSizeInMB}MB`);
        }

        loadingIndicator.classList.remove('hidden');
        loadingIndicator.querySelector('p').textContent = 'Analyzing your image...';
        
        const base64Image = await getBase64(file);
        
        // Prepare the request to YOUR BACKEND SERVER
        const requestBody = {
            mimeType: file.type,
            image: base64Image.split(',')[1] // Send only the base64 data part
        };

        // Set up request timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        // Call your own server's endpoint
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        }).finally(() => clearTimeout(timeoutId));

        if (!response.ok) {
            let errorMessage;
            try {
                const errorData = await response.json();
                errorMessage = errorData.error;
            } catch {
                errorMessage = response.statusText;
            }

            throw new Error(errorMessage || `Server error: ${response.status}`);
        }

        const data = await response.json();
        const result = parseGeminiResponse(data);
        const colors = result.colors;
        const gender = result.gender;
        
        if (!colors || colors.length === 0) {
            throw new Error('No colors were detected in the image. Please try a different image with clearer clothing items.');
        }

        displayResults(colors, gender);
        resultsSection.classList.remove('hidden');
        
    } catch (error) {
        console.error('Error analyzing image:', error);
        if (error.name === 'AbortError') {
            showError('The request took too long to complete. Please try again.');
        } else {
            showError(error.message);
        }
    } finally {
        loadingIndicator.classList.add('hidden');
        loadingIndicator.querySelector('p').textContent = 'Detecting colors on your outfit...';
    }
}


function parseGeminiResponse(data) {
    //console.log('Parsing Gemini response:', data);
    const detectedColors = [];
    let detectedGender = null;
    
    try {
        // Extract the text content from the Gemini response
        const text = data.candidates[0].content.parts[0].text;

        // Split by line and clean up
        const lines = text.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        lines.forEach(line => {
            // Remove any parentheses and extra whitespace
            const cleanedLine = line.replace(/[()]/g, '').trim();
            
            // Split on colon and clean up both parts
            const parts = cleanedLine.split(':').map(part => part.trim());
            if (parts.length === 2) {
                const [key, value] = parts;
                
                // Check if this is a gender line (case insensitive)
                if (key.toLowerCase() === 'gender') {
                    detectedGender = value.trim();
                    // Normalize gender values
                    if (detectedGender.toLowerCase().includes('male') && !detectedGender.toLowerCase().includes('female')) {
                        detectedGender = 'Male';
                    } else if (detectedGender.toLowerCase().includes('female')) {
                        detectedGender = 'Female';
                    }
                    return; // Skip to next line
                }
                
                // Otherwise, treat as clothing item and color
                const [clothingType, colorName] = parts;
                
                // Look for an exact match first
                let matchedColor = window.colorData.colors.find(
                    color => color.name.toLowerCase() === colorName.toLowerCase()
                );

                // If no exact match, try fuzzy matching
                if (!matchedColor) {
                    for (const color of window.colorData.colors) {
                        if (colorName.toLowerCase().includes(color.name.toLowerCase()) ||
                            color.name.toLowerCase().includes(colorName.toLowerCase())) {
                            matchedColor = color;
                            break;
                        }
                    }
                }

                if (matchedColor) {
                    detectedColors.push({
                        clothing: clothingType,
                        name: matchedColor.name,
                        hex: matchedColor.hex,
                        rgb: matchedColor.rgb,
                        index: matchedColor.index
                    });
                } else {
                    console.log(`No match found for: ${clothingType} : ${colorName}`);
                }
            }
        });
    } catch (error) {
        console.error('Error parsing Gemini response:', error);
    }
    return { colors: detectedColors, gender: detectedGender };
}



 function displayResults(detectedColors, gender) {
    // Track analyzed colors in the database
    for (const color of detectedColors) {
        try {
            fetch('/api/track/color', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    colorData: color
                })
            });
        } catch (err) {
            console.error('Failed to track color:', color.name, err);
        }
    }


    // Track gender separately in genderStats collection
    if (gender) {
        try {
            fetch('/api/track/gender', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gender: gender })
            });
        } catch (err) {
            console.error('Failed to track gender:', gender, err);
        }
    }

    //console.log('Displaying results for colors:', detectedColors);
    const detectedColorsList = document.getElementById('detectedColorsList');
    const recommendationsContainer = document.querySelector('.recommended-combinations');
    const generationSection = document.getElementById('generationSection');

    // Clear everything from previous run
    detectedColorsList.innerHTML = '';
    selectedClothesToKeep = [];
    selectedCombination = null;
    activeColorFilter = null;
    allRecommendations = [];
    updateGenerateButtonState();

    if (detectedColors.length === 0) {
        detectedColorsList.innerHTML = `
            <div class="no-colors-found">
                <p>No matching colors found in the Wada Sanzo palette.</p>
                <p>Try uploading a different image or adjusting the lighting.</p>
            </div>
        `;
        // Hide the generate button if no results
        generationSection.classList.add('hidden');
        return;
    }

    // Show the generate button section now that we have results
    generationSection.classList.remove('hidden');

    // Display detected colors with interactive checkboxes
    detectedColors.forEach(color => {
        const colorItem = document.createElement('div');
        colorItem.className = 'color-item interactive filter-trigger'; // Add new class
        colorItem.dataset.colorName = color.name; // Store color name in a data attribute
        colorItem.dataset.colorIndex = color.index; // Store color index for tracking

        // Create color item without checkbox
        colorItem.innerHTML = `
            <input type="checkbox" value="${color.clothing}" style="display: none;">
            <div class="color-item-label">
                <div class="color-swatch" style="background-color: ${color.hex}"></div>
                <div class="color-info">
                    <div class="color-name">${color.name}</div>
                    <div class="clothing-type">${color.clothing}</div>
                </div>
            </div>
        `;
        detectedColorsList.appendChild(colorItem);

        // Add click listener to the entire item for selection
        colorItem.addEventListener('click', (e) => {
            const checkbox = colorItem.querySelector('input');
            const isSelected = colorItem.classList.contains('selected');
            
            if (isSelected) {
                // Deselect
                colorItem.classList.remove('selected');
                selectedClothesToKeep = selectedClothesToKeep.filter(item => item !== color.clothing);
                checkbox.checked = false;
            } else {
                // Select
                colorItem.classList.add('selected');
                selectedClothesToKeep.push(color.clothing);
                checkbox.checked = true;
            }
            updateGenerateButtonState();            
            // Re-render combinations based on new selection
            renderCombinations();
        });

    });
    
    // Get all possible recommendations and store them
    allRecommendations = findColorCombinations(detectedColors);

    // Initial render of all combinations
    renderCombinations(); 
}

async function generateNewOutfit() {
    const imageInput = document.getElementById('imageInput');
    const file = imageInput.files[0];

    // Validate requirements with specific messages
    if (!file) {
        showError("Please upload an image first.");
        return;
    }
    if (!selectedCombination) {
        showError("Please select a color combination before generating.");
        return;
    }
    if (selectedClothesToKeep.length === 0) {
        showError("Please select at least one clothing item to keep in the new outfit.");
        return;
    }

    const loadingIndicator = document.getElementById('loadingIndicator');
    const generateButton = document.getElementById('generateButton');

    // Track selected colors and combination
    try {
        // Track selected colors
        const detectedColorsList = document.getElementById('detectedColorsList');
        const selectedColorItems = detectedColorsList.querySelectorAll('input[type="checkbox"]:checked');
        
        for (const checkbox of selectedColorItems) {
            const colorItem = checkbox.closest('.color-item');
            const colorData = {
                name: colorItem.dataset.colorName,
                hex: colorItem.querySelector('.color-swatch').style.backgroundColor,
                clothing: checkbox.value,
                index: parseInt(colorItem.dataset.colorIndex) || 0
            };

            await fetch('/api/track/color', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    colorData,
                    userId: 'anonymous'
                })
            });
        }

        // Track combination selection
        if (selectedCombination) {
            await fetch('/api/track/combination', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    combinationIndex: selectedCombination.index,
                    colors: selectedCombination.names,
                    userId: 'anonymous'
                })
            });
        }
    } catch (err) {
        console.error('Failed to track selection:', err);
    }

    try {
        loadingIndicator.querySelector('p').textContent = 'Generating your new outfit... This may take a moment.';
        loadingIndicator.classList.remove('hidden');
        generateButton.disabled = true; // Prevent multiple clicks

        const base64Image = await getBase64(file);

        const requestBody = {
            image: base64Image.split(',')[1],
            mimeType: file.type,
            clothesToKeep: selectedClothesToKeep,
            combination: selectedCombination,
            style: selectedStyle
        };

        const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server responded with status: ${response.status}`);
        }

        const result = await response.json();

        // Check if we received the image data
        if (result.imageData && result.mimeType) {
            const popupImage = document.getElementById('popupImage');
            const imagePopupModal = document.getElementById('imagePopupModal');

            // Create a Data URL from the base64 string received from the server
            // This is the key change: "data:[MIME_TYPE];base64,[IMAGE_DATA]"
            popupImage.src = `data:${result.mimeType};base64,${result.imageData}`;
            
            // Store the image URL for the search page
            if (result.imageUrl) {
                localStorage.setItem('generatedImageUrl', result.imageUrl);
                popupImage.setAttribute('data-server-url', result.imageUrl);
            }

            // Show the modal
            imagePopupModal.classList.remove('hidden');
            
            // Update gallery count
            updateGalleryCount();
            
            // Add search button listener
            addSearchButtonListener();
        } else {
            // Handle cases where the server might not have returned an image
            throw new Error(result.error || 'Server did not return image data.');
        }

    } catch (error) {
        console.error('Error generating image:', error);
        showError(`Failed to generate new outfit: ${error.message}`);
    } finally {
        loadingIndicator.classList.add('hidden');
        loadingIndicator.querySelector('p').textContent = 'Detecting colors on your outfit...'; // Reset text
        generateButton.disabled = false; // Re-enable button
    }
}

// Add search button functionality
function addSearchButtonListener() {
    const searchButton = document.getElementById('searchButton');
    if (searchButton) {
        // Remove existing event listeners to avoid duplicates
        searchButton.removeEventListener('click', handleSearchClick);
        searchButton.removeEventListener('touchend', handleSearchClick);
        
        // Add both click and touch events for better mobile support
        searchButton.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            handleSearchClick();
        });
        
        searchButton.addEventListener('touchend', function(event) {
            event.preventDefault();
            event.stopPropagation();
            handleSearchClick();
        });
        
    } else {
        console.log('Search button not found');
    }
}

// Mobile detection
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           (window.innerWidth <= 768 && 'ontouchstart' in window);
}

// Mobile-specific optimizations
function optimizeForMobile() {
    if (isMobileDevice()) {
        console.log('Mobile device detected, applying optimizations');
        
        // Prevent zoom on double tap
        let lastTouchEnd = 0;
        document.addEventListener('touchend', function (event) {
            const now = (new Date()).getTime();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, false);
        
        // Improve touch scrolling
        document.body.style.webkitOverflowScrolling = 'touch';
        
        // Optimize modal for mobile
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.style.webkitOverflowScrolling = 'touch';
        });
    }
}

// Initialize mobile optimizations
document.addEventListener('DOMContentLoaded', function() {
    optimizeForMobile();
});

async function handleSearchClick() {
    
    try {
        // Get the generated outfit image
        const popupImage = document.getElementById('popupImage');
        if (!popupImage || !popupImage.src) {
            alert('No outfit image available for analysis');
            return;
        }
        
        // Show loading indicator
        showSearchLoading();
        
        let imageData, mimeType;
        
        // Check if the image is a data URL or a regular URL
        if (popupImage.src.startsWith('data:')) {
            // It's already a base64 data URL
            imageData = popupImage.src.split(',')[1];
            mimeType = popupImage.src.split(',')[0].split(':')[1].split(';')[0];
        } else {
            // It's a regular URL (from gallery), need to fetch and convert to base64
            console.log('Converting gallery image to base64...');
            try {
                const response = await fetch(popupImage.src);
                const blob = await response.blob();
                mimeType = blob.type || 'image/png';
                
                // Convert blob to base64
                const base64Data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const dataUrl = reader.result;
                        resolve(dataUrl.split(',')[1]);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                
                imageData = base64Data;
            } catch (fetchError) {
                console.error('Error converting image to base64:', fetchError);
                hideSearchLoading();
                alert('Failed to load image for analysis');
                return;
            }
        }
        
        console.log('Analyzing outfit for clothing items in Turkish...');
        
        // Analyze the outfit to get clothing items in Turkish
        const analysisResponse = await fetch('/api/analyze-outfit-turkish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: imageData,
                mimeType: mimeType
            })
        });

        if (!analysisResponse.ok) {
            hideSearchLoading();
            throw new Error('Failed to analyze outfit items');
        }

        const analysisData = await analysisResponse.json();
        console.log('Outfit analysis result (Turkish):', analysisData);

        if (analysisData.items && analysisData.items.length > 0) {
            // Search for items on Trendyol and Zara
            console.log('Searching for items on Trendyol and Zara...');
            const searchResponse = await fetch('/api/search-clothing-sites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: analysisData.items,
                    gender: analysisData.gender
                })
            });

            if (!searchResponse.ok) {
                hideSearchLoading();
                throw new Error('Failed to search clothing items');
            }

            const searchData = await searchResponse.json();
            console.log('Search results:', searchData);

            // Get the generated image URL
            const generatedImageUrl = localStorage.getItem('generatedImageUrl');
            
            // Store search data in sessionStorage instead of URL to avoid referrer header limit
            sessionStorage.setItem('searchResults', JSON.stringify(searchData));
            sessionStorage.setItem('searchImageUrl', generatedImageUrl || '');
            
            console.log('Redirecting to search page with stored data');
            window.location.href = 'search.html';
        } else {
            hideSearchLoading();
            alert('No clothing items detected in the outfit');
        }
    } catch (error) {
        hideSearchLoading();
        console.error('Error in search process:', error);
        alert('Error analyzing outfit: ' + error.message);
    }
}

// Show search loading indicator
function showSearchLoading() {
    const searchButton = document.getElementById('searchButton');
    if (searchButton) {
        searchButton.disabled = true;
        searchButton.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinning">
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
            Analyzing Outfit...
        `;
        searchButton.style.opacity = '0.7';
        searchButton.style.cursor = 'not-allowed';
    }
}

// Hide search loading indicator
function hideSearchLoading() {
    const searchButton = document.getElementById('searchButton');
    if (searchButton) {
        searchButton.disabled = false;
        searchButton.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
            </svg>
            Search Similar Items
        `;
        searchButton.style.opacity = '1';
        searchButton.style.cursor = 'pointer';
    }
}

// Make the function globally accessible
window.handleSearchClick = handleSearchClick;

// Add search button listener on page load as well
document.addEventListener('DOMContentLoaded', function() {
    addSearchButtonListener();
    
    // Mobile-specific: Retry adding listeners after a short delay
    setTimeout(() => {
        addSearchButtonListener();
    }, 500);
});

// Add event delegation as a fallback for both click and touch events
document.addEventListener('click', function(event) {
    if (event.target && event.target.id === 'searchButton') {
        console.log('Search button clicked via event delegation');
        event.preventDefault();
        event.stopPropagation();
        handleSearchClick();
    }
});

// Add touch event support for mobile devices
document.addEventListener('touchend', function(event) {
    if (event.target && event.target.id === 'searchButton') {
        console.log('Search button touched via event delegation');
        event.preventDefault();
        event.stopPropagation();
        handleSearchClick();
    }
});

// Add touchstart to prevent double-tap issues on mobile
document.addEventListener('touchstart', function(event) {
    if (event.target && event.target.id === 'searchButton') {
        event.preventDefault();
    }
});

function updateGenerateButtonState() {
    const generateButton = document.getElementById('generateButton');
    // Enable the button only if at least one combination is selected
    if (selectedCombination) {
        generateButton.disabled = false;
    } else {
        generateButton.disabled = true;
    }
}

function findColorCombinations(detectedColors) {
    const foundCombinations = new Map(); // Use Map to avoid duplicates

    // For each detected color, find its combinations
    detectedColors.forEach(color => {
        // Find the exact color in our dataset
        const matchedColor = window.colorData.colors.find(c => 
            c.name.toLowerCase() === color.name.toLowerCase()
        );

        if (matchedColor && matchedColor.combinations) {
            
            // Add each combination
            matchedColor.combinations.forEach(combIndex => {
                const combination = window.combinationsData.combinations[combIndex];
                if (combination) {
                    // Use combination index as key to avoid duplicates
                    foundCombinations.set(combIndex, {
                        index: combIndex,
                        names: combination.names,
                        codes: combination.codes
                    });
                }
            });
        } else {
            console.log(`No combinations found for ${color.name}`);
        }
    });

    // Convert Map to Array
    const combinations = Array.from(foundCombinations.values());
    console.log(`Total unique combinations found: ${combinations.length}`);
    return combinations;
}

function createCombinationElement(combination) {
    //console.log('Creating element for combination:', combination);
    const element = document.createElement('div');
    element.className = 'combination-pair';
    
    // Create color strip
    const colorStrip = document.createElement('div');
    colorStrip.className = 'color-strip';
    colorStrip.style.display = 'flex';
    
    // Add each color as a block
    combination.codes.forEach(rgbCode => {
        try {
            // Handle both RGB string format and direct hex values
            let backgroundColor;
            const rgbMatch = rgbCode.match(/R:(\d+) \/ G:(\d+) \/ B:(\d+)/);
            
            if (rgbMatch) {
                backgroundColor = `rgb(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]})`;
            } else if (rgbCode.startsWith('#')) {
                backgroundColor = rgbCode;
            } else {
                console.warn('Invalid RGB code format:', rgbCode);
                backgroundColor = '#CCCCCC'; // Fallback color
            }

            const colorBlock = document.createElement('div');
            colorBlock.style.flex = '1';
            colorBlock.style.backgroundColor = backgroundColor;
            colorStrip.appendChild(colorBlock);
        } catch (error) {
            console.error('Error creating color block:', error, rgbCode);
            // Create a fallback color block
            const colorBlock = document.createElement('div');
            colorBlock.style.flex = '1';
            colorBlock.style.backgroundColor = '#CCCCCC';
            colorStrip.appendChild(colorBlock);
        }
    });
    
    // Create combination details
    const details = document.createElement('div');
    details.className = 'combo-details';
    details.innerHTML = `
        <div class="combination-number">Combination ${combination.index}</div>
        <div class="combo-colors">
            ${combination.names.map(name => `
                <div class="combo-color" data-full-name="${name}">
                    <span class="color-name">${name}</span>
                </div>
            `).join('<span class="combo-divider">+</span>')}
        </div>
    `;
    
    element.appendChild(colorStrip);
    element.appendChild(details);
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
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.style.backgroundColor = '#fee';
    errorDiv.style.color = '#c00';
    errorDiv.style.padding = '15px';
    errorDiv.style.borderRadius = '8px';
    errorDiv.style.margin = '20px 0';
    errorDiv.style.border = '1px solid #fcc';
    
    const errorTitle = document.createElement('h3');
    errorTitle.style.marginBottom = '10px';
    errorTitle.textContent = 'Oops! Something went wrong';
    
    const errorText = document.createElement('p');
    
    // Convert technical errors into user-friendly messages
    let userFriendlyMessage = message;
    if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
        userFriendlyMessage = 'Unable to connect to the server. Please check your internet connection and try again.';
    } else if (message.includes('API key')) {
        userFriendlyMessage = 'The service is temporarily unavailable. Please try again later.';
    } else if (message.includes('500')) {
        userFriendlyMessage = 'The service is experiencing technical difficulties. Please try again in a few minutes.';
    } else if (message.includes('404')) {
        userFriendlyMessage = 'The requested service is not available. Please try again later.';
    } else if (message.includes('413')) {
        userFriendlyMessage = 'The image file is too large. Please try with a smaller image.';
    } else if (message.includes('unsupported file type') || message.includes('MIME type')) {
        userFriendlyMessage = 'Please upload a valid image file (JPG or PNG format).';
    } else if (message.includes('timeout')) {
        userFriendlyMessage = 'The request took too long to complete. Please try again.';
    }
    
    errorText.textContent = userFriendlyMessage;
    
    // Add retry suggestion for most errors
    const helpText = document.createElement('p');
    helpText.style.marginTop = '10px';
    helpText.style.fontSize = '0.9em';
    helpText.style.color = '#666';
    
    if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
        helpText.innerHTML = 'Suggestions:<br>' +
            '1. Check your internet connection<br>' +
            '2. Try refreshing the page<br>' +
            '3. Clear your browser cache';
    } else if (message.includes('timeout') || message.includes('500')) {
        helpText.innerHTML = 'Suggestions:<br>' +
            '1. Wait a few minutes and try again<br>' +
            '2. Try with a different image<br>' +
            '3. If the problem persists, try again later';
    }
    
    errorDiv.appendChild(errorTitle);
    errorDiv.appendChild(errorText);
    if (helpText.innerHTML) {
        errorDiv.appendChild(helpText);
    }
    
    // Remove any existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Add the error message to the page
    const analyzerContainer = document.querySelector('.analyzer-container');
    analyzerContainer.insertBefore(errorDiv, analyzerContainer.firstChild);
    
    // Auto-hide error after 10 seconds
    setTimeout(() => {
        const currentError = document.querySelector('.error-message');
        if (currentError) {
            currentError.style.transition = 'opacity 0.5s ease-out';
            currentError.style.opacity = '0';
            setTimeout(() => currentError.remove(), 500);
        }
    }, 10000);
}

// Add listener for the main generate button
const generateButton = document.getElementById('generateButton');

generateButton.addEventListener('click', async () => {
    if (!selectedCombination || !imageInput.files[0]) {
        alert('Please select an image and a combination first!');
        return;
    }

    // User info (replace with real userId if available)
    const userId = window.userId || 'anonymous';

    // Track selected colors and combination number
    const selectedColors = [];
    for (const clothing of selectedClothesToKeep) {
        const color = Array.isArray(window.colorData.colors)
            ? window.colorData.colors.find(c => c.clothing === clothing)
            : null;
        if (color) {
            selectedColors.push(color);
        }
    }
    // Track colors
    for (const color of selectedColors) {
        try {
            await fetch('/api/track/color', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ colorData: color, userId })
            });
        } catch (err) {
            console.error('Failed to track color:', color.name, err);
        }
    }
    // Track combination
    if (selectedCombination && selectedCombination.index !== undefined) {
        try {
            await fetch('/api/track/combination', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    combinationIndex: selectedCombination.index,
                    colors: selectedCombination.names,
                    userId
                })
            });
        } catch (err) {
            console.error('Failed to track combination:', selectedCombination.index, err);
        }
    }

    const loadingIndicator = document.getElementById('loadingIndicator');
    loadingIndicator.classList.remove('hidden');
    
    try {
        const file = imageInput.files[0];
        const base64Image = await getBase64(file);

        const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: base64Image.split(',')[1],
                mimeType: file.type,
                clothesToKeep: selectedClothesToKeep,
                combination: selectedCombination
            })
        });

        if (!response.ok) throw new Error('Failed to generate image.');

        const result = await response.json();
        
        // Display the result in the popup
        document.getElementById('popupImage').src = result.imageUrl;
        document.getElementById('imagePopupModal').classList.remove('hidden');

    } catch (error) {
        console.error('Generation Error:', error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add('hidden');
    }
});

function getSelectedColorNames() {
    const selectedColorNames = [];
    const detectedColorsList = document.getElementById('detectedColorsList');
    const selectedItems = detectedColorsList.querySelectorAll('.color-item.selected');
    
    selectedItems.forEach(item => {
        const colorName = item.dataset.colorName;
        if (colorName) {
            selectedColorNames.push(colorName);
        }
    });
    
    return selectedColorNames;
}

function renderCombinations() {
    const recommendationsList = document.getElementById('recommendationsList');
    recommendationsList.innerHTML = ''; // Clear current combinations

    // Get selected color names from the selected clothes
    const selectedColorNames = getSelectedColorNames();
    
    // Determine which combinations to show
    let combinationsToRender;
    if (selectedColorNames.length > 0) {
        // Filter combinations that contain at least one of the selected colors
        combinationsToRender = allRecommendations.filter(combo => {
            return selectedColorNames.some(selectedColor => 
                combo.names.some(comboColor => 
                    comboColor.toLowerCase() === selectedColor.toLowerCase()
                )
            );
        });
    } else if (activeColorFilter) {
        // Fallback to the old single color filter
        combinationsToRender = allRecommendations.filter(combo => combo.names.includes(activeColorFilter));
    } else {
        // Show all combinations if no filter is applied
        combinationsToRender = allRecommendations;
    }

    // Reset selection if the currently selected combo is filtered out
    if (selectedCombination && !combinationsToRender.some(c => c.index === selectedCombination.index)) {
        selectedCombination = null;
        updateGenerateButtonState();
    }

    // Update the header to show filtering status
    const combinationsHeader = document.querySelector('.recommended-combinations h2');
    if (selectedColorNames.length > 0) {
        combinationsHeader.textContent = `Recommended Combinations (${combinationsToRender.length} matching your selected colors)`;
    } else {
        combinationsHeader.textContent = 'Recommended Combinations';
    }

    if (combinationsToRender.length > 0) {
        combinationsToRender.forEach(combo => {
            const comboElement = createCombinationElement(combo);
            
            // Re-apply 'selected' class if it's the active one
            if (selectedCombination && combo.index === selectedCombination.index) {
                comboElement.classList.add('selected');
            }

            // Add click listener to select a combination for generation
            comboElement.addEventListener('click', () => {
                selectedCombination = combo;

                document.querySelectorAll('.combination-pair').forEach(el => el.classList.remove('selected'));
                comboElement.classList.add('selected');
                
                // Add visual feedback
                comboElement.style.transform = 'scale(0.98)';
                setTimeout(() => {
                    comboElement.style.transform = '';
                }, 150);
                
                updateGenerateButtonState();
            });

            recommendationsList.appendChild(comboElement);
        });
    } else {
        if (selectedColorNames.length > 0) {
            recommendationsList.innerHTML = `
                <div class="no-combinations-found">
                    <p>No combinations found that match your selected colors.</p>
                    <p>Try selecting different colors or upload a different image.</p>
                </div>
            `;
        } else {
            recommendationsList.innerHTML = `
                <div class="no-combinations-found">
                    <p>No color combinations found for the detected colors.</p>
                    <p>Try uploading a different image or adjusting the lighting.</p>
                </div>
            `;
        }
    }
}


// Add a navigation link to the main page
const mainPageNav = document.createElement('a');
mainPageNav.href = 'index.html';
mainPageNav.className = 'back-to-main';
mainPageNav.textContent = '← Back to Color Combinations';
document.querySelector('header').appendChild(mainPageNav);

// Download function for generated images
function downloadGeneratedImage() {
    const popupImage = document.getElementById('popupImage');
    const imageSrc = popupImage.src;
    
    if (!imageSrc || imageSrc === '') {
        showError('No image available to download. Please generate an image first.');
        return;
    }
    
    try {
        // Create a temporary anchor element to trigger download
        const link = document.createElement('a');
        link.href = imageSrc;
        
        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        link.download = `wada-sanzo-outfit-${timestamp}.png`;
        
        // Append to body, click, and remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        console.log('Image download initiated');
    } catch (error) {
        console.error('Error downloading image:', error);
        showError('Failed to download image. Please try again.');
    }
}

// Gallery functions
async function updateGalleryCount() {
    try {
        const response = await fetch('/api/session-images', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            const countElement = document.getElementById('galleryCount');
            if (countElement) {
                countElement.textContent = data.count || 0;
            }
        }
    } catch (error) {
        console.error('Error updating gallery count:', error);
    }
}

async function openGallery() {
    const galleryModal = document.getElementById('galleryModal');
    const galleryGrid = document.getElementById('galleryGrid');
    const galleryEmpty = document.getElementById('galleryEmpty');
    
    // Show modal
    galleryModal.classList.remove('hidden');
    
    // Show loading state
    galleryGrid.innerHTML = `
        <div class="gallery-loading">
            <div class="spinner"></div>
            <p>Loading your outfits...</p>
        </div>
    `;
    galleryEmpty.classList.add('hidden');
    
    try {
        const response = await fetch('/api/session-images', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to load images');
        }
        
        const data = await response.json();
        
        if (data.images && data.images.length > 0) {
            // Display images
            galleryGrid.innerHTML = data.images.map(image => `
                <div class="gallery-item">
                    <img src="${image.url}" alt="Generated Outfit" class="gallery-item-image" onclick="viewGalleryImage('${image.url}')">
                    <div class="gallery-item-info">
                        <div class="gallery-item-time">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            ${formatTime(image.timestamp)}
                        </div>
                        <div class="gallery-item-actions">
                            <button class="gallery-item-btn gallery-btn-view" onclick="viewGalleryImage('${image.url}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                                View
                            </button>
                            <button class="gallery-item-btn gallery-btn-download" onclick="downloadGalleryImage('${image.url}', '${image.filename}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                Save
                            </button>
                            <button class="gallery-item-btn gallery-btn-delete" onclick="deleteGalleryImage('${image.filename}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            `).join('');
        } else {
            // Show empty state
            galleryGrid.innerHTML = '';
            galleryEmpty.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error loading gallery:', error);
        galleryGrid.innerHTML = `
            <div class="gallery-loading">
                <p style="color: #f44336;">Failed to load images. Please try again.</p>
            </div>
        `;
    }
}

function closeGallery() {
    const galleryModal = document.getElementById('galleryModal');
    galleryModal.classList.add('hidden');
}

function viewGalleryImage(imageUrl) {
    const popupImage = document.getElementById('popupImage');
    const imagePopupModal = document.getElementById('imagePopupModal');
    
    popupImage.src = imageUrl;
    imagePopupModal.classList.remove('hidden');
    
    // Store the URL for search functionality
    localStorage.setItem('generatedImageUrl', imageUrl);
    
    // Close gallery
    closeGallery();
    
    // Re-attach search listener
    addSearchButtonListener();
}

function downloadGalleryImage(imageUrl, filename) {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filename || 'outfit.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function deleteGalleryImage(filename) {
    if (!confirm('Are you sure you want to delete this image?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/session-images/${filename}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (response.ok) {
            // Refresh gallery
            await openGallery();
            await updateGalleryCount();
        } else {
            alert('Failed to delete image. Please try again.');
        }
    } catch (error) {
        console.error('Error deleting image:', error);
        alert('Failed to delete image. Please try again.');
    }
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString();
}