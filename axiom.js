(function () {
  'use strict';

  const ENDPOINT = '/api/axiom';
  const MAX_MESSAGES = 7;
  const MAX_INPUT = 1000;

  let history = [];
  let busy = false;
  let controller = null;

  // AXIOM interface elements
  const log = document.getElementById('axiom-log');
  const form = document.getElementById('axiom-form');
  const input = document.getElementById('axiom-input');

 // Display a message in the AXIOM chat
  function addMessage(text, sender) {
    const message = document.createElement('div');

    message.classList.add('msg');

    if (sender === 'ai') {
      message.classList.add('msg-ai');
    } else {
      message.classList.add('msg-user');
    }

    message.textContent = text;
    log.appendChild(message);

    log.scrollTop = log.scrollHeight;

    return message;
  }

   // Read current MACHINA simulator values
  function getSimulatorState() {
    return {
      engine: {
        rpm: document.getElementById('rpm-value')?.textContent ?? 'Unavailable',
        temperature: document.getElementById('temp-value')?.textContent ?? 'Unavailable',
        boost: document.getElementById('boost-value')?.textContent ?? 'Unavailable'
      },

      gearbox: {
        gear: document.getElementById('gb-gear')?.textContent ?? 'Unavailable',
        rpm: document.getElementById('gb-rpm')?.textContent ?? 'Unavailable',
        speed: document.getElementById('gb-speed')?.textContent ?? 'Unavailable'
      }
    };
  }

   // Control the chat while AXIOM is responding
  function setBusy(state) {
    busy = state;

    input.disabled = state;

    const sendButton = form.querySelector('button[type="submit"]');

    if (sendButton) {
      sendButton.disabled = state;
      sendButton.textContent = state ? 'THINKING...' : 'SEND';
    }
  }

    // Make sure the AXIOM interface exists
  if (!log || !form || !input) {
    console.error('AXIOM: Chat interface elements not found.');
    return;
  }

    // Handle user messages
  form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (busy) return;

    const question = input.value.trim();

    if (!question) return;

    if (question.length > MAX_INPUT) {
      addMessage('Your question is too long. Please keep it under 1000 characters.', 'ai');
      return;
    }

    addMessage(question, 'user');

    history.push({
      role: 'user',
      content: question
    });

    input.value = '';
  });
})();