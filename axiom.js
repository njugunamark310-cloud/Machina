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
  const input = document.getElementById('axiom-input')

})();

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