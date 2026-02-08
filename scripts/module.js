const MODULE_ID = "pf2e-villain-points";
const SETTING_NAME = "villainPoints";
const POS_FLAG = "hudPosition";

/**
 * Class to manage Data and Logic
 */
class VillainPointManager {
    static get points() {
        return game.settings.get(MODULE_ID, SETTING_NAME);
    }

    static async setPoints(value) {
        if (!game.user.isGM) return;
        const clamped = Math.max(0, Math.min(3, value));
        await game.settings.set(MODULE_ID, SETTING_NAME, clamped);
    }

    static async spendPoint() {
        if (!game.user.isGM) return false;
        const current = this.points;
        if (current > 0) {
            await this.setPoints(current - 1);
            return true;
        }
        return false;
    }

    static async rerollMessage(messageId) {
        if (!game.user.isGM) return;
        const message = game.messages.get(messageId);
        if (!message) return;

        if (await this.spendPoint()) {
            await ChatMessage.create({
                content: `<div style="text-align:center; font-weight:bold; color:darkred;">
                            <i class="fa-solid fa-skull-crossbones"></i> The Villain twists fate! 
                            <br>Reroll initiated.
                          </div>`,
                speaker: { alias: "Gamemaster" }
            });

            const rolls = message.rolls;
            if (rolls && rolls.length > 0) {
                const roll = rolls[0];
                const newRoll = await roll.reroll();
                await newRoll.toMessage({
                    flavor: `${message.flavor} <br><strong>(Villain Point Reroll)</strong>`,
                    speaker: message.speaker
                });
            }
        } else {
            ui.notifications.warn("No Villain Points remaining!");
        }
    }
}

/**
 * Class to manage the UI/HUD
 */
class VillainHUD extends Application {
    constructor() {
        super();
        this._dragHandler = null;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "villain-points-hud",
            template: null,
            popOut: false,
            resizable: false, // Ensure this is false
            minimizable: false // Prevents right-click collapsing
        });
    }

    /**
     * Fix for the "Jumping" bug:
     * We must update the internal this.position state so Draggable knows where we are.
     */
    async setPosition({ left, top }) {
        const hud = document.getElementById("villain-points-hud");
        if (hud) {
            hud.style.left = `${left}px`;
            hud.style.top = `${top}px`;
            
            // Sync internal state to prevent snapping to 0,0 on next drag
            this.position.left = left;
            this.position.top = top;

            await game.user.setFlag(MODULE_ID, POS_FLAG, { left, top });
        }
    }

    render(force = false) {
        let hud = document.getElementById("villain-points-hud");
        
        // 1. Initial Setup (Run Once)
        if (!hud) {
            hud = document.createElement("div");
            hud.id = "villain-points-hud";
            
            // Build the static skeleton (Handle + Title + Content Area)
            hud.innerHTML = `
                <div id="vp-drag-bar">
                    <i class="fas fa-arrows-up-down-left-right vp-drag-handle" title="Drag to move"></i>
                </div>
                <h3>Villain Points</h3>
                <div id="vp-skull-container" class="vp-container"></div>
            `;
            
            document.body.append(hud);
            
            // Apply saved position
            const pos = game.user.getFlag(MODULE_ID, POS_FLAG);
            if (pos) {
                hud.style.left = `${pos.left}px`;
                hud.style.top = `${pos.top}px`;
                // Sync internal state immediately
                this.position.left = pos.left;
                this.position.top = pos.top;
            }

            // Initialize Draggable ONCE. 
            // We target the specifically ID'd drag bar now for better control.
            const dragHandle = hud.querySelector(".vp-drag-handle");
            if (dragHandle) {
                this._dragHandler = new Draggable(this, hud, dragHandle, { resizable: false });
            }
        }

        // 2. Dynamic Update (Runs on every point change)
        const container = document.getElementById("vp-skull-container");
        if (!container) return; // Safety check

        const points = VillainPointManager.points;
        const isGM = game.user.isGM;
        const interactClass = isGM ? "interactive" : "";

        let html = ``;
        for (let i = 1; i <= 3; i++) {
            const isActive = i <= points ? "active" : "inactive";
            html += `<i class="fa-solid fa-skull vp-point ${isActive} ${interactClass}" data-idx="${i}"></i>`;
        }
        
        container.innerHTML = html;

        // 3. Re-attach Listeners to Skulls (GM Only)
        if (isGM) {
            const skulls = container.querySelectorAll(".vp-point");
            skulls.forEach(skull => {
                skull.addEventListener("click", async (ev) => {
                    const idx = parseInt(ev.target.dataset.idx);
                    const current = VillainPointManager.points;
                    if (idx > current) {
                        await VillainPointManager.setPoints(idx);
                    } else if (idx === current) {
                        await VillainPointManager.setPoints(idx - 1);
                    } else {
                        await VillainPointManager.setPoints(idx);
                    }
                });
                
                skull.addEventListener("contextmenu", async (ev) => {
                    ev.preventDefault();
                    await VillainPointManager.setPoints(0);
                });
            });
        }
    }
}

const villainHUD = new VillainHUD();

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once('init', () => {
    game.settings.register(MODULE_ID, SETTING_NAME, {
        name: "Villain Points",
        scope: "world",
        config: false,
        type: Number,
        default: 0,
        onChange: () => villainHUD.render()
    });
});

Hooks.once('ready', () => {
    villainHUD.render(true);
    console.log("PF2e Villain Points | HUD Initialized");
});

Hooks.on("updateUser", (user, changes) => {
    if (user.id === game.user.id && changes.flags?.[MODULE_ID]) {
        // Just re-render. Since we don't nuke the HUD element anymore, 
        // this is safe and efficient.
        villainHUD.render();
    }
});

Hooks.on("getChatLogEntryContext", (html, options) => {
    options.push({
        name: "Reroll with Villain Point",
        icon: '<i class="fas fa-skull"></i>',
        condition: (li) => {
            const messageId = li.data("messageId") || li.attr("data-message-id");
            if (!messageId) return false;

            const message = game.messages.get(messageId);
            if (!message) return false;

            const isGM = game.user.isGM;
            const hasRolls = message.rolls && message.rolls.length > 0;
            const hasPoints = VillainPointManager.points > 0;

            return isGM && hasRolls && hasPoints;
        },
        callback: (li) => {
            const messageId = li.data("messageId") || li.attr("data-message-id");
            VillainPointManager.rerollMessage(messageId);
        }
    });
});