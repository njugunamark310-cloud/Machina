/* MACHINA - AXIOM AI Assistant */

(function () {
  'use strict';

  const ENDPOINT =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? '/api/axiom'
      : 'https://machina.njugunamark310.workers.dev';
  const MAX_MESSAGES = 12;
  const MAX_INPUT = 1000;

  let history = [];
  let busy = false;
  let controller = null;

  const log = document.getElementById('axiom-log');
  const form = document.getElementById('axiom-form');
  const input = document.getElementById('axiom-input');

  if (!log || !form || !input) {
    console.error('AXIOM: Chat interface elements not found.');
    return;
  }

  input.maxLength = MAX_INPUT;
  input.setAttribute('aria-label', 'Ask AXIOM an automotive engineering question');
  log.setAttribute('aria-live', 'polite');

  // Safely format inline Markdown.
  function renderInline(element, text) {
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      element.appendChild(
        document.createTextNode(text.slice(lastIndex, match.index))
      );

      const token = match[0];
      let formatted;

      if (token.startsWith('**')) {
        formatted = document.createElement('strong');
        formatted.textContent = token.slice(2, -2);
      } else if (token.startsWith('`')) {
        formatted = document.createElement('code');
        formatted.textContent = token.slice(1, -1);
      } else {
        formatted = document.createElement('em');
        formatted.textContent = token.slice(1, -1);
      }

      element.appendChild(formatted);
      lastIndex = pattern.lastIndex;
    }

    element.appendChild(
      document.createTextNode(text.slice(lastIndex))
    );
  }

  // Convert Markdown blocks into safe, structured HTML.
  function renderMarkdown(element, markdown) {
    element.replaceChildren();

    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    let index = 0;

    while (index < lines.length) {
      const line = lines[index].trim();

      if (!line) {
        index++;
        continue;
      }

      // Headings
      const heading = line.match(/^(#{1,3})\s+(.+)$/);

      if (heading) {
        const level = heading[1].length;
        const node = document.createElement(`h${level + 1}`);
        node.className = 'axiom-heading';

        renderInline(node, heading[2]);
        element.appendChild(node);

        index++;
        continue;
      }

      // Horizontal divider
      if (/^(-{3,}|\*{3,})$/.test(line)) {
        element.appendChild(document.createElement('hr'));
        index++;
        continue;
      }

      // Bullet and numbered lists
      const bullet = line.match(/^[-*]\s+(.+)$/);
      const numbered = line.match(/^\d+[.)]\s+(.+)$/);

      if (bullet || numbered) {
        const ordered = Boolean(numbered);
        const list = document.createElement(ordered ? 'ol' : 'ul');
        list.className = 'axiom-list';

        while (index < lines.length) {
          const current = lines[index].trim();
          const item = ordered
            ? current.match(/^\d+[.)]\s+(.+)$/)
            : current.match(/^[-*]\s+(.+)$/);

          if (!item) break;

          const listItem = document.createElement('li');
          renderInline(listItem, item[1]);
          list.appendChild(listItem);

          index++;
        }

        element.appendChild(list);
        continue;
      }

      // Blockquotes
      if (line.startsWith('> ')) {
        const quote = document.createElement('blockquote');
        quote.className = 'axiom-quote';

        renderInline(quote, line.slice(2));
        element.appendChild(quote);

        index++;
        continue;
      }

      // Regular paragraphs
      const paragraph = document.createElement('p');
      paragraph.className = 'axiom-paragraph';

      const paragraphLines = [];

      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^(#{1,3}\s|[-*]\s+|\d+[.)]\s+|>{1}\s|(-{3,}|\*{3,})$)/.test(lines[index].trim())
      ) {
        paragraphLines.push(lines[index].trim());
        index++;
      }

      renderInline(paragraph, paragraphLines.join(' '));
      element.appendChild(paragraph);
    }
  }

  // Display a chat message.
  function addMessage(text, sender) {
    const message = document.createElement('div');

    message.classList.add('msg');
    message.classList.add(sender === 'ai' ? 'msg-ai' : 'msg-user');

    if (sender === 'ai') {
      renderMarkdown(message, text);
    } else {
      message.textContent = text;
    }

    log.appendChild(message);
    log.scrollTop = log.scrollHeight;

    return message;
  }

  // Read current MACHINA simulator values.
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

  // Lock or unlock the chat while AXIOM responds.
  function setBusy(state) {
    busy = state;
    input.disabled = state;

    const sendButton = form.querySelector('button[type="submit"]');

    if (sendButton) {
      sendButton.disabled = state;
      sendButton.textContent = state ? 'THINKING...' : 'SEND';
    }
  }

  // Send conversation to the local AI backend.
  async function ask() {
    setBusy(true);

    const reply = addMessage('Thinking...', 'ai');
    controller = new AbortController();

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: history.slice(-MAX_MESSAGES),
          sim: getSimulatorState()
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        let errorMessage = 'AXIOM server error.';

        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {}

        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error('The server did not provide a response.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        answer += decoder.decode(value, { stream: true });
        reply.textContent = answer;
        log.scrollTop = log.scrollHeight;
      }

      answer += decoder.decode();
      reply.textContent = answer;

      if (!answer.trim()) {
        throw new Error('AXIOM returned an empty response.');
      }

      renderMarkdown(reply, answer);
      history.push({
        role: 'assistant',
        content: answer
      });

      log.scrollTop = log.scrollHeight;

    } catch (error) {
      reply.replaceChildren();
      reply.textContent = error.name === 'AbortError'
        ? 'AXIOM request cancelled.'
        : error.message || 'AXIOM could not connect.';

      console.error('AXIOM:', error);

    } finally {
      controller = null;
      setBusy(false);
      input.focus();
    }
  }

  // Quick access prompts.
  document.querySelectorAll('.axiom-quick-btn').forEach(function (button) {
    button.addEventListener('click', function () {
      if (busy) return;

      input.value = button.dataset.prompt || '';
      form.requestSubmit();
    });
  });

  // Handle submitted questions.
  form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (busy) return;

    const question = input.value.trim();

    if (!question) return;

    if (question.length > MAX_INPUT) {
      addMessage('Please keep your question under 1000 characters.', 'ai');
      return;
    }

    addMessage(question, 'user');

    history.push({
      role: 'user',
      content: question
    });

    input.value = '';
    ask();
  });

  console.log('AXIOM: Frontend initialized successfully.');

})();
