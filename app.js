// Track API calls
const trackAPI = {
    async trackVisit(userId) {
        try {
            await fetch('/api/track/visit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });
        } catch (error) {
            console.error('Error tracking visit:', error);
        }
    },

    async trackColorSelection(colorData, userId) {
        try {
            await fetch('/api/track/color', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ colorData, userId })
            });
        } catch (error) {
            console.error('Error tracking color selection:', error);
        }
    },

    async trackCombinationSelection(combinationIndex, colors, userId) {
        try {
            await fetch('/api/track/combination', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ combinationIndex, colors, userId })
            });
        } catch (error) {
            console.error('Error tracking combination selection:', error);
        }
    }
};

// Load popular colors from database API
async function loadPopularColors() {
    try {
        // Fetch REAL popular colors from database
        const response = await fetch('/api/popular-colors', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch popular colors');
        }
        
        const data = await response.json();
        let popularColors = data.popularColors || [];
        
        
        // Merge with full color data to get combinations property
        if (window.colorData && Array.isArray(window.colorData)) {
            popularColors = popularColors.map(popularColor => {
                
                // Try both exact match and type-coerced match
                let fullColorData = window.colorData.find(c => c.index === popularColor.index);
                
                // If not found, try converting types
                if (!fullColorData) {
                    const indexAsNumber = parseInt(popularColor.index);
                    fullColorData = window.colorData.find(c => c.index === indexAsNumber);
                }
                return fullColorData ? { ...fullColorData, selectionCount: popularColor.selectionCount } : popularColor;
            });
        } else {
            console.warn('window.colorData not available yet! Popular colors will not have combinations.');
        }
        
        displayPopularColors(popularColors);
    } catch (error) {
        console.error('Error loading popular colors:', error);
        // Show fallback message
        const popularGrid = document.getElementById('popular-colors-grid');
        if (popularGrid) {
            popularGrid.innerHTML = `
                <div class="no-popular-colors">
                    <p>Popular colors will appear here as users discover their favorites.</p>
                </div>
            `;
        }
    }
}

// Display popular colors
function displayPopularColors(popularColors) {
    const popularGrid = document.getElementById('popular-colors-grid');
    if (!popularGrid) return;

    if (!popularColors || popularColors.length === 0) {
        popularGrid.innerHTML = `
            <div class="no-popular-colors">
                <p>Popular colors will appear here as users discover their favorites.</p>
            </div>
        `;
        return;
    }

    popularGrid.innerHTML = popularColors.map((color, idx) => `
        <div class="popular-color-item" data-color-index-ref="${idx}">
            <div class="popular-color-swatch" style="background-color: ${color.hex}"></div>
            <div class="popular-color-name">${color.name}</div>
            <div class="popular-color-count">${color.selectionCount || 0} selections</div>
        </div>
    `).join('');

    // Store popularColors for later access
    window.popularColorsData = popularColors;

    // Add click listeners to popular color items
    popularGrid.querySelectorAll('.popular-color-item').forEach((item, idx) => {
        item.addEventListener('click', () => {
            const colorData = window.popularColorsData[idx];
            // Open the modal instead of inline preview
            showCombinations(colorData);
        });
    });
}

// Load popular combinations from database
async function loadPopularCombinations() {
    try {
        const response = await fetch('/api/popular-combinations', {
            credentials: 'include'
        });
        if (!response.ok) {
            throw new Error('Failed to fetch popular combinations');
        }
        
        const data = await response.json();
        displayPopularCombinations(data.popularCombinations);
    } catch (error) {
        console.error('Error loading popular combinations:', error);
        // Show fallback message
        const popularCombinationsGrid = document.getElementById('popular-combinations-grid');
        if (popularCombinationsGrid) {
            popularCombinationsGrid.innerHTML = `
                <div class="no-popular-colors">
                    <p>Popular combinations will appear here as users discover their favorites.</p>
                </div>
            `;
        }
    }
}

// Display popular combinations
function displayPopularCombinations(popularCombinations) {
    const popularCombinationsGrid = document.getElementById('popular-combinations-grid');
    if (!popularCombinationsGrid) return;

    if (!popularCombinations || popularCombinations.length === 0) {
        popularCombinationsGrid.innerHTML = `
            <div class="no-popular-colors">
                <p>Popular combinations will appear here as users discover their favorites.</p>
            </div>
        `;
        return;
    }

    popularCombinationsGrid.innerHTML = popularCombinations.map(combination => {
        // Get the actual combination data from the loaded JSON
        const combinationData = window.allRecommendations && window.allRecommendations[combination.combinationIndex];
        
        // Handle the JSON structure which has names and codes arrays
        let colors = [];
        if (combinationData) {
            if (combinationData.names && combinationData.codes) {
                // Convert RGB codes to hex values
                colors = combinationData.codes.map((code, index) => {
                    const rgbMatch = code.match(/R:(\d+)\s*\/\s*G:(\d+)\s*\/\s*B:(\d+)/);
                    if (rgbMatch) {
                        const r = parseInt(rgbMatch[1]);
                        const g = parseInt(rgbMatch[2]);
                        const b = parseInt(rgbMatch[3]);
                        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
                        return {
                            name: combinationData.names[index] || 'Unknown',
                            hex: hex
                        };
                    }
                    return { name: 'Unknown', hex: '#ffffff' };
                });
            } else if (combinationData.colors) {
                // Fallback to colors array if it exists
                colors = combinationData.colors;
            }
        }
        
        return `
            <div class="popular-combination-item">
                <div class="popular-combination-colors">
                    ${colors && colors.length > 0 ? 
                        colors.map(color => `
                            <div class="popular-combination-color" style="background-color: ${color.hex || '#ffffff'}" title="${color.name || 'Unknown'}"></div>
                        `).join('') : 
                        '<div class="popular-combination-color" style="background-color: #cccccc" title="No colors available"></div>'
                    }
                </div>
                <div class="combination-number">Combination #${combination.combinationIndex}</div>
                <div class="popular-combination-info">
                    <div class="popular-combination-count">${combination.selectionCount} selections</div>
                </div>
            </div>
        `;
    }).join('');

    // No click listeners - combinations are display-only
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Track visit
        await trackAPI.trackVisit();
        
        // Load popular colors after main data is loaded
        
        // Load both color data files
        console.log('Loading color data...');
        console.log('Fetching files...');
        const [colorResponse, combinationsResponse] = await Promise.all([
            fetch('color.json').catch(error => {
                console.error('Error fetching color.json:', error);
                throw error;
            }),
            fetch('combined_colors.json').catch(error => {
                console.error('Error fetching combined_colors.json:', error);
                throw error;
            })
        ]);

        if (!colorResponse.ok || !combinationsResponse.ok) {
            throw new Error('Failed to load color data');
        }

        const [colorData, combinationsData] = await Promise.all([
            colorResponse.json(),
            combinationsResponse.json()
        ]);

        if (!colorData.colors || !Array.isArray(colorData.colors)) {
            throw new Error('Invalid color data format');
        }

        const colors = colorData.colors;
        const combinations = combinationsData.combinations;

        // Get DOM elements
        const colorClosetGrid = document.getElementById('color-closet-grid');
        const combinationsModal = document.getElementById('combinations-modal');
        const selectedColorName = document.getElementById('selected-color-name');
        const combinationsGrid = document.getElementById('combinations-grid');
        
        if (!colorClosetGrid || !combinationsModal || !selectedColorName || !combinationsGrid) {
            throw new Error('Required DOM elements not found');
        }

        // Set up modal close button
        const closeButton = document.querySelector('.close-modal');
        closeButton.addEventListener('click', () => {
            combinationsModal.classList.add('hidden');
        });

        // Close modal when clicking outside
        combinationsModal.addEventListener('click', (e) => {
            if (e.target === combinationsModal) {
                combinationsModal.classList.add('hidden');
            }
        });

        // Close modal with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !combinationsModal.classList.contains('hidden')) {
                combinationsModal.classList.add('hidden');
            }
        });

        // Create color boxes for the main grid
        colors.forEach(color => {
            const colorBox = createColorBox(color);
            colorClosetGrid.appendChild(colorBox);
        });
        console.log('Successfully created color grid');
        
        // Store the data globally for use in popular combinations
        window.allRecommendations = combinations;
        window.colorData = colors;
        console.log('Data stored globally - combinations:', combinations.length, 'colors:', colors.length);

        function createColorBox(color, isInCombination = false) {
            const container = document.createElement('div');
            container.className = 'color-card-container';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            container.style.width = '100%';

            const box = document.createElement('div');
            box.className = 'color-box';
            box.style.backgroundColor = color.hex || '#000000';
            box.setAttribute('data-color-index', color.index);

            const info = document.createElement('div');
            info.className = 'color-info';
            
            // Create detailed color info
            const colorDetails = document.createElement('div');
            colorDetails.className = 'color-details';
            colorDetails.innerHTML = `
                <div class="color-name">${color.name || 'Unnamed Color'}</div>
                <div class="color-values">
                    <span class="hex">${color.hex}</span>
                    ${isInCombination ? `<span class="rgb">${color.rgb}</span>` : ''}
                </div>
            `;
            
            info.appendChild(colorDetails);
            container.appendChild(box);
            container.appendChild(info);

            // Add click event to show combinations
            box.addEventListener('click', () => {
                // Remove selected class from all boxes
                document.querySelectorAll('.color-box').forEach(box => {
                    box.classList.remove('selected');
                });
                // Add selected class to clicked box
                box.classList.add('selected');
                showCombinations(color);
            });

            return container;
        }

        function showCombinations(color) {
            console.log('Showing combinations for color:', color);
            // Track color selection
            trackAPI.trackColorSelection(color);
            
            selectedColorName.textContent = color.name;
            combinationsGrid.innerHTML = '';
            
            // Update the combinations preview area
            updateCombinationsPreview(color);

            // Add the close button to the modal
            const closeButton = document.createElement('button');
            closeButton.className = 'modal-close';
            closeButton.innerHTML = '×';
            closeButton.onclick = () => combinationsModal.classList.add('hidden');
            combinationsGrid.appendChild(closeButton);

            // Add the selected color information header
            const colorInfo = document.createElement('div');
            colorInfo.className = 'selected-color-info';
            colorInfo.style.setProperty('--color', color.hex);
            colorInfo.innerHTML = `
                <div class="color-preview" style="background-color: ${color.hex}"></div>
                <div class="color-details">
                    <h3>${color.name}</h3>
                    <div class="color-values">
                        <div class="color-value">
                            <span class="value-label">HEX</span>
                            <span class="value-content">${color.hex}</span>
                        </div>
                        <div class="color-value">
                            <span class="value-label">RGB</span>
                            <span class="value-content">${color.rgb}</span>
                        </div>
                        <div class="color-value">
                            <span class="value-label">CMYK</span>
                            <span class="value-content">${color.cmyk}</span>
                        </div>
                    </div>
                </div>
            `;
            combinationsGrid.appendChild(colorInfo);

            // Get all combination numbers
            console.log('Color combinations:', color.combinations);
            
            // Check if combinations exist
            if (!color.combinations || !Array.isArray(color.combinations)) {
                const noCombo = document.createElement('div');
                noCombo.className = 'no-combinations';
                noCombo.textContent = 'No combinations available for this color';
                combinationsGrid.appendChild(noCombo);
                return;
            }
            
            const validCombinations = color.combinations.filter(combIndex => {
                const exists = combinations[combIndex];
                if (!exists) {
                    console.log('Could not find combination with index:', combIndex);
                }
                return exists;
            });

            console.log('Found valid combinations:', validCombinations);
            
            if (validCombinations.length === 0) {
                const noCombo = document.createElement('div');
                noCombo.className = 'no-combinations';
                noCombo.textContent = 'No combinations found for this color';
                combinationsGrid.appendChild(noCombo);
            } else {
                // Create combinations container
                const combosContainer = document.createElement('div');
                combosContainer.className = 'combinations-container';
                
                // Add combinations header
                const combosHeader = document.createElement('div');
                combosHeader.className = 'combinations-header';
                combosHeader.innerHTML = `
                    <h2>Color Combinations</h2>
                    <p class="combinations-count">${validCombinations.length} harmonious combinations</p>
                `;
                combosContainer.appendChild(combosHeader);

                // Create each combination
                validCombinations.forEach((combIndex) => {
                    const combinationSet = combinations[combIndex];
                    const comboWrapper = document.createElement('div');
                    comboWrapper.className = 'combination-pair';
                    
                    const comboPreview = document.createElement('div');
                    comboPreview.className = 'combination-preview';
                    
                    // Create the color strip with all colors in the combination
                    const colorStrip = document.createElement('div');
                    colorStrip.className = 'color-strip';
                    colorStrip.style.display = 'flex';
                    colorStrip.style.height = '120px';
                    colorStrip.style.marginBottom = '15px';
                    colorStrip.style.borderRadius = '4px';
                    colorStrip.style.overflow = 'hidden';
                    
                    combinationSet.codes.forEach(rgbCode => {
                        const rgb = rgbCode.match(/R:(\d+) \/ G:(\d+) \/ B:(\d+)/);
                        const colorBlock = document.createElement('div');
                        colorBlock.style.flex = '1';
                        if (rgb) {
                            colorBlock.style.backgroundColor = `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`;
                        }
                        colorStrip.appendChild(colorBlock);
                    });

                    comboPreview.appendChild(colorStrip);
                    comboPreview.innerHTML += `
                        <div class="combo-details">
                            <div class="combination-number">Combination ${combIndex}</div>
                            <div class="combo-colors">
                                ${combinationSet.names.map((name, i) => `
                                    <div class="combo-color">
                                        <span class="color-name">${name}</span>
                                    </div>
                                `).join(`
                                    <span class="combo-divider">+</span>
                                `)}
                            </div>
                        </div>
                    `;
                    
                    comboWrapper.appendChild(comboPreview);
                    combosContainer.appendChild(comboWrapper);
                });

                combinationsGrid.appendChild(combosContainer);
            }

            // Show the modal
            combinationsModal.classList.remove('hidden');

            // Highlight the selected color in the main grid
            const allBoxes = document.querySelectorAll('.color-box');
            allBoxes.forEach(box => {
                if (box.getAttribute('data-color-index') === color.index.toString()) {
                    box.style.boxShadow = '0 0 0 3px #333, 0 4px 12px rgba(0,0,0,0.2)';
                } else {
                    box.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                }
            });
        }

        // Expose showCombinations globally so it can be called from popular colors
        window.showCombinations = showCombinations;

        // Now load popular colors and combinations after showCombinations is available
        loadPopularColors().catch(err => console.error('Error loading popular colors:', err));
        loadPopularCombinations().catch(err => console.error('Error loading popular combinations:', err));

        function updateCombinationsPreview(color) {
            const combinationsPreview = document.getElementById('combinations-preview');
            if (!combinationsPreview) return;

            // Check if combinations exist
            if (!color.combinations || !Array.isArray(color.combinations)) {
                combinationsPreview.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🎨</div>
                        <h3>No combinations available for ${color.name}</h3>
                        <p>This color doesn't have any predefined combinations yet.</p>
                    </div>
                `;
                return;
            }

            // Get all combination numbers
            const validCombinations = color.combinations.filter(combIndex => {
                const exists = combinations[combIndex];
                if (!exists) {
                    console.log('Could not find combination with index:', combIndex);
                }
                return exists;
            });

            if (validCombinations.length === 0) {
                combinationsPreview.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🎨</div>
                        <h3>No combinations found for ${color.name}</h3>
                        <p>This color doesn't have any predefined combinations yet.</p>
                    </div>
                `;
            } else {
                // Show preview of combinations
                combinationsPreview.innerHTML = `
                    <div class="combinations-preview-content">
                        <h3>Perfect Combinations with ${color.name}</h3>
                        <p>${validCombinations.length} harmonious combinations available</p>
                        <div class="preview-combinations">
                            ${validCombinations.slice(0, 3).map(combIndex => {
                                const combinationSet = combinations[combIndex];
                                return `
                                    <div class="preview-combination" onclick="showCombinations(${JSON.stringify(color).replace(/"/g, '&quot;')})">
                                        <div class="preview-color-strip">
                                            ${combinationSet.codes.map(rgbCode => {
                                                const rgb = rgbCode.match(/R:(\d+) \/ G:(\d+) \/ B:(\d+)/);
                                                if (rgb) {
                                                    return `<div style="background-color: rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]}); height: 40px; flex: 1;"></div>`;
                                                }
                                                return '';
                                            }).join('')}
                                        </div>
                                        <div class="preview-combination-info">
                                            <span>Combination ${combIndex}</span>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                        <button class="view-all-combinations" data-color-name="${color.name}" data-color-hex="${color.hex}" data-color-index="${color.index}">
                            View All ${validCombinations.length} Combinations
                        </button>
                    </div>
                `;
            }
        }

        // Add event listener for View All Combinations button
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('view-all-combinations')) {
                const colorData = {
                    name: e.target.dataset.colorName,
                    hex: e.target.dataset.colorHex,
                    index: parseInt(e.target.dataset.colorIndex)
                };
                showCombinations(colorData);
            }
        });

    } catch (error) {
        console.error('Error:', error);
        // Display error message on the page
        const main = document.querySelector('main');
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red';
        errorDiv.style.padding = '20px';
        errorDiv.style.backgroundColor = '#ffe6e6';
        errorDiv.style.borderRadius = '8px';
        errorDiv.style.margin = '20px 0';
        errorDiv.innerHTML = `
            <h3>Error Loading Application</h3>
            <p>${error.message}</p>
        `;
        main.appendChild(errorDiv);
    }
});

