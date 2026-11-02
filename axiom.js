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