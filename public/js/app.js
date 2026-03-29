// PickTime Frontend Application
class PickTimeApp {
    constructor() {
        this.themes = {};
        this.selectedTheme = null;
        this.init();
    }

    async init() {
        await this.loadThemes();
        this.renderFeatures();
        this.renderThemes();
        this.setupEventListeners();
    }

    async loadThemes() {
        try {
            const response = await fetch('/api/themes');
            this.themes = await response.json();
        } catch (error) {
            console.error('Failed to load themes:', error);
            // Fallback themes
            this.themes = {
                beauty: {
                    name: 'מכון יופי',
                    colors: { primary: '#FF6B9D', secondary: '#C44569' },
                    icon: 'sparkles'
                }
            };
        }
    }

    renderFeatures() {
        const features = [
            {
                icon: 'calendar-days',
                title: 'יומן חכם',
                description: 'ניהול תורים מתקדם עם תצוגת יומן אינטואיטיבית ותמיכה בכמה מטפלים'
            },
            {
                icon: 'bell',
                title: 'התראות אוטומטיות',
                description: 'תזכורות ללקוחות בווטסאפ, SMS ואימייל. הודעות על תורים שהתפנו'
            },
            {
                icon: 'users',
                title: 'ניהול לקוחות',
                description: 'בסיס נתונים מלא עם היסטוריית טיפולים, העדפות ותוכנית נאמנות'
            },
            {
                icon: 'clock',
                title: 'רשימת המתנה',
                description: 'לקוחות יכולים להירשם לרשימת המתנה לתורים תפוסים'
            },
            {
                icon: 'credit-card',
                title: 'תשלומים מובנים',
                description: 'קבלת מקדמות ותשלומים מלאים ישירות דרך הפלטפורמה'
            },
            {
                icon: 'chart-bar',
                title: 'דוחות ואנליטיקס',
                description: 'תובנות עסקיות, דוחות הכנסות ומעקב אחר ביצועי המטפלים'
            },
            {
                icon: 'device-phone-mobile',
                title: 'ממשק מובייל',
                description: 'אפליקציה מותאמת לנייד עם תמיכה מלאה בכל התכונות'
            },
            {
                icon: 'globe-alt',
                title: 'QR ולינק אישי',
                description: 'לכל עסק QR קוד ולינק אישי להזמנות מהירות'
            },
            {
                icon: 'cog',
                title: 'התאמה אישית',
                description: 'עיצוב מותאם, הגדרת שירותים ושעות עבודה גמישות'
            }
        ];

        const featuresContainer = document.querySelector('#features .grid');
        featuresContainer.innerHTML = features.map(feature => `
            <div class="feature-card bg-white rounded-xl p-6 shadow-lg">
                <div class="w-12 h-12 bg-gradient-to-r from-primary to-secondary rounded-lg flex items-center justify-center mb-4">
                    <heroicon-${feature.icon} class="w-6 h-6 text-white"></heroicon-${feature.icon}>
                </div>
                <h3 class="text-xl font-semibold text-gray-900 mb-2">${feature.title}</h3>
                <p class="text-gray-600">${feature.description}</p>
            </div>
        `).join('');
    }

    renderThemes() {
        const themesContainer = document.getElementById('themes-grid');
        themesContainer.innerHTML = Object.entries(this.themes).map(([key, theme]) => `
            <div class="theme-card bg-white rounded-xl p-6 shadow-lg" 
                 onclick="app.selectTheme('${key}')"
                 style="border: 2px solid ${theme.colors.primary}20">
                <div class="text-center">
                    <div class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" 
                         style="background: linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.secondary})">
                        <heroicon-${theme.icon} class="w-8 h-8 text-white"></heroicon-${theme.icon}>
                    </div>
                    <h3 class="text-xl font-semibold text-gray-900 mb-2">${theme.name}</h3>
                    
                    <div class="flex justify-center space-x-2 mb-4">
                        <div class="w-6 h-6 rounded-full" style="background-color: ${theme.colors.primary}"></div>
                        <div class="w-6 h-6 rounded-full" style="background-color: ${theme.colors.secondary}"></div>
                        <div class="w-6 h-6 rounded-full" style="background-color: ${theme.colors.accent}"></div>
                    </div>
                    
                    <p class="text-gray-600 text-sm">מותאם במיוחד לעסקי ${theme.name}</p>
                </div>
            </div>
        `).join('');
    }

    selectTheme(themeKey) {
        this.selectedTheme = themeKey;
        // Visual feedback
        document.querySelectorAll('.theme-card').forEach(card => {
            card.style.transform = 'scale(1)';
            card.style.boxShadow = '';
        });
        
        event.currentTarget.style.transform = 'scale(1.05)';
        event.currentTarget.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.2)';
        
        // Update setup form if open
        if (document.getElementById('setupModal').style.display !== 'none') {
            this.updateSetupForm();
        }
    }

    setupEventListeners() {
        // Smooth scrolling for navigation links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });

        // Close modal on outside click
        document.getElementById('setupModal').addEventListener('click', (e) => {
            if (e.target.id === 'setupModal') {
                this.closeSetup();
            }
        });
    }

    startSetup() {
        const modal = document.getElementById('setupModal');
        modal.style.display = 'flex';
        modal.classList.remove('hidden');
        this.renderSetupForm();
        document.body.style.overflow = 'hidden';
    }

    closeSetup() {
        const modal = document.getElementById('setupModal');
        modal.style.display = 'none';
        modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
    }

    renderSetupForm() {
        const form = document.getElementById('businessSetupForm');
        form.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">שם העסק</label>
                    <input type="text" name="businessName" required 
                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                           placeholder="למשל: סלון יופי של שרה">
                </div>
                
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">סוג העסק</label>
                    <select name="category" required onchange="app.updateThemeSelection(this.value)"
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent">
                        <option value="">בחר סוג עסק</option>
                        <option value="beauty">מכון יופי</option>
                        <option value="hair">מספרה</option>
                        <option value="fitness">כושר ואימונים</option>
                        <option value="tutoring">שיעורים פרטיים</option>
                        <option value="medical">שירותי בריאות</option>
                        <option value="tech">שירותים טכניים</option>
                    </select>
                </div>
                
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">שם המנהל</label>
                    <input type="text" name="ownerName" required 
                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                           placeholder="השם המלא שלך">
                </div>
                
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">טלפון</label>
                    <input type="tel" name="phone" required 
                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                           placeholder="050-1234567">
                </div>
                
                <div class="md:col-span-2">
                    <label class="block text-sm font-medium text-gray-700 mb-2">אימייל</label>
                    <input type="email" name="email" required 
                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                           placeholder="your@email.com">
                </div>
                
                <div class="md:col-span-2">
                    <label class="block text-sm font-medium text-gray-700 mb-2">כתובת העסק</label>
                    <input type="text" name="address" 
                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                           placeholder="רחוב, עיר">
                </div>
                
                <div class="md:col-span-2" id="themePreview">
                    <!-- Theme preview will be inserted here -->
                </div>
            </div>
            
            <div class="flex justify-end space-x-4 mt-8">
                <button type="button" onclick="app.closeSetup()" 
                        class="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                    ביטול
                </button>
                <button type="submit" 
                        class="px-8 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors">
                    🚀 ליצור את העסק!
                </button>
            </div>
        `;

        // Add form submission handler
        form.addEventListener('submit', (e) => this.handleSetupSubmit(e));
    }

    updateThemeSelection(category) {
        if (this.themes[category]) {
            this.selectedTheme = category;
            this.updateSetupForm();
        }
    }

    updateSetupForm() {
        if (!this.selectedTheme) return;
        
        const theme = this.themes[this.selectedTheme];
        const preview = document.getElementById('themePreview');
        
        if (preview) {
            preview.innerHTML = `
                <div class="bg-gray-50 rounded-lg p-4">
                    <h4 class="text-sm font-medium text-gray-700 mb-3">תצוגה מקדימה של העיצוב</h4>
                    <div class="bg-white rounded-lg p-4 border-2" style="border-color: ${theme.colors.primary}">
                        <div class="flex items-center space-x-3 mb-3">
                            <div class="w-8 h-8 rounded-full flex items-center justify-center" 
                                 style="background-color: ${theme.colors.primary}">
                                <heroicon-${theme.icon} class="w-4 h-4 text-white"></heroicon-${theme.icon}>
                            </div>
                            <div>
                                <h5 class="font-semibold" style="color: ${theme.colors.text}">השם של העסק</h5>
                                <p class="text-xs" style="color: ${theme.colors.secondary}">${theme.name}</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <button class="text-sm py-2 px-3 rounded text-white" 
                                    style="background-color: ${theme.colors.primary}">הזמן תור</button>
                            <button class="text-sm py-2 px-3 rounded" 
                                    style="color: ${theme.colors.primary}; border: 1px solid ${theme.colors.primary}">צפה בשירותים</button>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    async handleSetupSubmit(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const businessData = {
            name: formData.get('businessName'),
            category: formData.get('category'),
            theme: this.selectedTheme || formData.get('category'),
            owner: {
                name: formData.get('ownerName'),
                email: formData.get('email'),
                phone: formData.get('phone')
            },
            contact: {
                phone: formData.get('phone'),
                email: formData.get('email'),
                address: {
                    street: formData.get('address')
                }
            }
        };

        try {
            // Show loading state
            const submitBtn = e.target.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = '⏳ יוצר את העסק...';
            submitBtn.disabled = true;

            const response = await fetch('/api/businesses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(businessData)
            });

            if (!response.ok) {
                throw new Error('שגיאה ביצירת העסק');
            }

            const business = await response.json();
            
            // Success! Redirect to business page
            this.showSuccess(business);

        } catch (error) {
            console.error('Error creating business:', error);
            alert('שגיאה ביצירת העסק. אנא נסה שנית.');
            
            // Reset button
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.textContent = '🚀 ליצור את העסק!';
            submitBtn.disabled = false;
        }
    }

    showSuccess(business) {
        const modal = document.getElementById('setupModal');
        modal.querySelector('.bg-white').innerHTML = `
            <div class="p-8 text-center">
                <div class="text-6xl mb-4">🎉</div>
                <h3 class="text-2xl font-bold text-gray-900 mb-4">מזל טוב!</h3>
                <p class="text-lg text-gray-600 mb-6">
                    העסק <strong>${business.name}</strong> נוצר בהצלחה!
                </p>
                
                <div class="bg-gray-50 rounded-lg p-4 mb-6">
                    <p class="text-sm text-gray-600 mb-2">הקישור האישי שלך:</p>
                    <div class="bg-white p-3 rounded border text-sm font-mono">
                        ${window.location.origin}/${business.slug}
                    </div>
                </div>
                
                <div class="space-y-3">
                    <button onclick="window.location.href = '/${business.slug}'" 
                            class="w-full bg-primary text-white py-3 rounded-lg hover:bg-secondary transition-colors">
                        🏠 עבור לדף העסק
                    </button>
                    <button onclick="app.closeSetup()" 
                            class="w-full border border-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-50 transition-colors">
                        סגור
                    </button>
                </div>
            </div>
        `;
    }

    showDemo() {
        // For now, just show an alert. In the future, this could open a demo modal
        alert('הדמו יהיה זמין בקרוב! 🚀');
    }
}

// Global functions for onclick handlers
function startSetup() {
    app.startSetup();
}

function closeSetup() {
    app.closeSetup();
}

function showDemo() {
    app.showDemo();
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new PickTimeApp();
});