document.addEventListener('DOMContentLoaded', async () => {
    try {
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
        });        if (!colorClosetGrid || !combinationsModal || !selectedColorName || !combinationsGrid) {
            throw new Error('Required DOM elements not found');
        }

        // Create color boxes for the main grid
        colors.forEach(color => {
            const colorBox = createColorBox(color);
            colorClosetGrid.appendChild(colorBox);
        });
        console.log('Successfully created color grid');

        function createColorBox(color, isInCombination = false) {
            const container = document.createElement('div');
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
            box.addEventListener('click', () => showCombinations(color));

            return container;
        }

        function showCombinations(color) {
            console.log('Showing combinations for color:', color);
            selectedColorName.textContent = color.name;
            combinationsGrid.innerHTML = '';

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
                    // Create color blocks instead of gradient
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
                        colorBlock.style.backgroundColor = `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`;
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
            <h3>Error Loading Colors</h3>
            <p>${error.message}</p>
            <p>Please make sure:</p>
            <ul>
                <li>The color.json file exists in the same directory as index.html</li>
                <li>You're running the page through a web server (not directly opening the file)</li>
                <li>The color.json file contains valid JSON data</li>
            </ul>
        `;
        main.appendChild(errorDiv);
    }
});