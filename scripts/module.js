const MODULE_ID = "pf2e-villain-points";
const FLAG_NAME = "villainPoints";

/**
 * Class to manage Data and Logic
 */
class VillainPointManager {
    static get points() {
        return game.user.getFlag(MODULE_ID, FLAG_NAME) ?? 0;
    }

    static async setPoints(value) {
        // Clamp between 0 and 3
        const clamped = Math.max(0, Math.min(3, value));
        await game.user.setFlag(MODULE_ID, FLAG_NAME, clamped);
    }

    static async spendPoint() {
        const current = this.points;
        if (current > 0) {
            await this.setPoints(current - 1);
            return true;
        }
        return false;
    }

    /**
     * The core logic to reroll a PF2e check.
     * We try to reuse PF2e's internal reroll mechanics if possible to keep metatdata,
     * otherwise we do a raw Foundry reroll.
     */
    static async rerollMessage(messageId) {
        const message = game.messages.get(messageId);
        if (!message) return;

        // Visual confirmation
        if (await this.spendPoint()) {
            
            // Send a chat card announcing the Villain Point usage
            await ChatMessage.create({
                content: `<div style="text-align:center; font-weight:bold; color:darkred;">
                            <i class="fa-solid fa-skull-crossbones"></i> The Villain twists fate! 
                            <br>Reroll initiated.
                          </div>`,
                speaker: { alias: "Gamemaster" } // Force GM alias
            });

            // PF2e Specific Reroll Logic
            // In modern PF2e, we check if it is a rerollable check
            const rolls = message.rolls;
            if (rolls && rolls.length > 0) {
                const roll = rolls[0];
                
                // If it's a D20 roll, we simply reroll the dice but keep the bonuses
                // The cleanest way in Foundry V12/V13 without breaking PF2e internals is roll.reroll()
                const newRoll = await roll.reroll();

                // Create the new message
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
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "villain-points-hud",
            template: null, // We will build HTML manually for simplicity
            popOut: false,
        });
    }

    /**
     * Render the HUD into the DOM
     */
    render(force = false) {
        if (!game.user.isGM) return; // Only for GMs

        // Check if element exists, if not create it
        let hud = document.getElementById("villain-points-hud");
        if (!hud) {
            hud = document.createElement("div");
            hud.id = "villain-points-hud";
            document.body.append(hud);
        }

        const points = VillainPointManager.points;

        // Build HTML
        let html = `<h3>Villain Points</h3><div class="vp-container">`;
        
        // Generate 3 skulls
        for (let i = 1; i <= 3; i++) {
            const isActive = i <= points ? "active" : "inactive";
            // Using a Skull icon
            html += `<i class="fa-solid fa-skull vp-point ${isActive}" data-idx="${i}"></i>`;
        }
        html += `</div>`;

        hud.innerHTML = html;

        // Activate Listeners (Click to toggle points manually for adjustment)
        const skulls = hud.querySelectorAll(".vp-point");
        skulls.forEach(skull => {
            skull.addEventListener("click", async (ev) => {
                const idx = parseInt(ev.target.dataset.idx);
                const current = VillainPointManager.points;
                
                // Logic: If clicking a skull higher than current, set to that.
                // If clicking the current max, remove one.
                if (idx > current) {
                    await VillainPointManager.setPoints(idx);
                } else if (idx === current) {
                    await VillainPointManager.setPoints(idx - 1);
                } else {
                    await VillainPointManager.setPoints(idx);
                }
            });
            
            // Right click to clear all (optional convenience)
            skull.addEventListener("contextmenu", async (ev) => {
                ev.preventDefault();
                await VillainPointManager.setPoints(0);
            });
        });
    }
}

// Instantiate the HUD
const villainHUD = new VillainHUD();

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once('ready', () => {
    if (game.user.isGM) {
        villainHUD.render(true);
    }
});

// Update HUD when the user flags change (reactivity)
Hooks.on("updateUser", (user, changes) => {
    if (user.id === game.user.id && changes.flags?.[MODULE_ID]) {
        villainHUD.render();
    }
});

// Add Context Menu to Chat
Hooks.on("getChatLogEntryContext", (html, options) => {
    options.push({
        name: "Reroll with Villain Point",
        icon: '<i class="fas fa-skull"></i>',
        condition: (li) => {
            const message = game.messages.get(li.data("messageId"));
            const hasRolls = message?.rolls.length > 0;
            const isGM = game.user.isGM;
            const hasPoints = VillainPointManager.points > 0;
            return isGM && hasRolls && hasPoints;
        },
        callback: (li) => {
            const messageId = li.data("messageId");
            VillainPointManager.rerollMessage(messageId);
        }
    });
});