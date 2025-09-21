class SortableList {
  constructor(options) {
    // Default options
    this.options = {
      list: null,
      controlled: true,
      handleSelector: ".drag-handle",
      itemSelector: ".interact-sortable-item",
      scrollSpeed: 10,
      scrollThreshold: 50,
      lockAxis: "y",
      animation: true,
    };

    // Merge with provided options
    if (options) {
      Object.keys(options).forEach((key) => {
        if (options[key] !== undefined) {
          this.options[key] = options[key];
        }
      });
    }

    // Internal state
    this.dragState = {
      item: null,
      clone: null,
      placeholder: null,
      startIndex: -1,
      currentIndex: -1,
      scrollInterval: null,
      originalParent: null,
      items: [],
    };

    // Initialize
    this.init();
  }

  init() {
    if (!this.options.list) {
      console.error("SortableList: list element is required");
      return;
    }

    // Store reference to container
    this.container =
      this.options.list.closest(".interact-sortable-container") ||
      this.options.list.parentElement;

    // Setup interact.js
    this.setupInteractable();

    // Listen for custom events
    this.setupEventListeners();
  }

  setupInteractable() {
    const self = this;

    // Make items draggable
    interact(this.options.itemSelector, {
      context: this.options.list,
    })
      .draggable({
        enabled: true,
        allowFrom: this.options.handleSelector,
        autoScroll: false, // We'll handle scrolling manually
        lockAxis: this.options.lockAxis,
        inertia: false,

        onstart: (event) => {
          self.onDragStart(event);
        },

        onmove: (event) => {
          self.onDragMove(event);
        },

        onend: (event) => {
          self.onDragEnd(event);
        },
      })
      .styleCursor(false);
  }

  onDragStart(event) {
    const item = event.target;

    // Prevent text selection on mobile
    event.interaction.preventDefault = true;

    // Store initial state
    this.dragState.item = item;
    this.dragState.originalParent = item.parentElement;
    this.dragState.items = Array.from(
      this.options.list.querySelectorAll(this.options.itemSelector)
    );
    this.dragState.startIndex = this.dragState.items.indexOf(item);
    this.dragState.currentIndex = this.dragState.startIndex;

    // Create clone for visual feedback
    const rect = item.getBoundingClientRect();
    const clone = item.cloneNode(true);
    clone.classList.add("interact-drag-clone");
    clone.style.width = rect.width + "px";
    clone.style.left = rect.left + "px";
    clone.style.top = rect.top + "px";
    document.body.appendChild(clone);
    this.dragState.clone = clone;

    // Add dragging class to original
    item.classList.add("interact-dragging");

    // Create placeholder (clone of the dragged item)
    const placeholder = item.cloneNode(true);
    placeholder.classList.remove("interact-dragging");
    placeholder.classList.add("interact-placeholder");
    placeholder.removeAttribute("id");
    placeholder.style.height = rect.height + "px";

    const handle = placeholder.querySelector(this.options.handleSelector);
    if (handle) {
      handle.style.visibility = "hidden";
    }

    item.parentElement.insertBefore(placeholder, item);
    this.dragState.placeholder = placeholder;
    item.style.display = "none";

    // Start auto-scroll monitoring
    this.startAutoScroll();
  }

  onDragMove(event) {
    const clone = this.dragState.clone;

    if (!clone) return;

    // Update clone position
    let x = (parseFloat(clone.style.left) || 0) + event.dx;
    let y = (parseFloat(clone.style.top) || 0) + event.dy;

    // Apply axis lock
    if (this.options.lockAxis === "y") {
      x = parseFloat(clone.style.left) || 0;
    } else if (this.options.lockAxis === "x") {
      y = parseFloat(clone.style.top) || 0;
    }

    clone.style.left = x + "px";
    clone.style.top = y + "px";

    // Check for reordering in optimistic mode
    if (!this.options.controlled) {
      this.checkReorder(event);
    }
  }

  checkReorder(event) {
    const clone = this.dragState.clone;
    const placeholder = this.dragState.placeholder;

    if (!clone || !placeholder) return;

    const cloneRect = clone.getBoundingClientRect();
    const items = Array.from(
      this.options.list.querySelectorAll(
        this.options.itemSelector + ":not(.interact-dragging)"
      )
    );

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      if (cloneRect.top + cloneRect.height / 2 < midpoint) {
        if (item.previousElementSibling !== placeholder) {
          item.parentElement.insertBefore(placeholder, item);
          this.dragState.currentIndex = i;
        }
        break;
      } else if (i === items.length - 1) {
        if (item.nextElementSibling !== placeholder) {
          item.parentElement.insertBefore(placeholder, item.nextElementSibling);
          this.dragState.currentIndex = i + 1;
        }
      }
    }
  }

  onDragEnd(event) {
    const item = this.dragState.item;
    const clone = this.dragState.clone;
    const placeholder = this.dragState.placeholder;

    // Stop auto-scroll
    this.stopAutoScroll();

    // Calculate final index
    let finalIndex = this.dragState.currentIndex;
    if (this.options.controlled) {
      finalIndex = this.calculateDropIndex(event);
    }

    // Remove clone
    if (clone) {
      clone.remove();
    }

    // Clean up based on mode
    if (this.options.controlled) {
      // Controlled mode: revert DOM changes
      if (placeholder) {
        placeholder.remove();
      }
      item.style.display = "";
      item.classList.remove("interact-dragging");
    } else {
      // Optimistic mode: commit DOM changes
      if (placeholder) {
        placeholder.replaceWith(item);
        item.style.display = "";
      }
      item.classList.remove("interact-dragging");
    }

    // Fire event if position changed
    if (finalIndex !== this.dragState.startIndex && finalIndex !== -1) {
      this.fireDropEvent({
        oldIndex: this.dragState.startIndex,
        newIndex: finalIndex,
        item: item,
      });
    }

    // Reset state
    this.dragState = {
      item: null,
      clone: null,
      placeholder: null,
      startIndex: -1,
      currentIndex: -1,
      scrollInterval: null,
      originalParent: null,
      items: [],
    };
  }

  calculateDropIndex(event) {
    const clone = this.dragState.clone;

    if (!clone) return -1;

    const cloneRect = clone.getBoundingClientRect();
    const items = Array.from(
      this.options.list.querySelectorAll(this.options.itemSelector)
    );

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === this.dragState.item) continue;

      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      if (cloneRect.top + cloneRect.height / 2 < midpoint) {
        return i > this.dragState.startIndex ? i - 1 : i;
      }
    }

    return items.length - 1;
  }

  fireDropEvent(data) {
    const event = new CustomEvent("interact-drop", {
      detail: {
        oldIndex: data.oldIndex,
        newIndex: data.newIndex,
        itemId: data.item.getAttribute("data-id") || data.item.id || null,
        sourceId: this.options.list.id || null,
        targetId: this.options.list.id || null,
        item: data.item,
      },
      bubbles: true,
      cancelable: true,
    });

    this.options.list.dispatchEvent(event);
  }

  startAutoScroll() {
    this.stopAutoScroll();

    this.dragState.scrollInterval = setInterval(() => {
      if (!this.dragState.clone || !this.container) return;

      const clone = this.dragState.clone;
      const cloneRect = clone.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();

      const scrollSpeed = this.options.scrollSpeed;
      const threshold = this.options.scrollThreshold;

      // Check top boundary
      if (cloneRect.top < containerRect.top + threshold) {
        const distance = Math.max(
          0,
          containerRect.top + threshold - cloneRect.top
        );
        const speed = Math.min(
          scrollSpeed,
          (distance / threshold) * scrollSpeed
        );
        this.container.scrollTop -= speed;
      }

      // Check bottom boundary
      if (cloneRect.bottom > containerRect.bottom - threshold) {
        const distance = Math.max(
          0,
          cloneRect.bottom - (containerRect.bottom - threshold)
        );
        const speed = Math.min(
          scrollSpeed,
          (distance / threshold) * scrollSpeed
        );
        this.container.scrollTop += speed;
      }
    }, 16); // ~60fps
  }

  stopAutoScroll() {
    if (this.dragState.scrollInterval) {
      clearInterval(this.dragState.scrollInterval);
      this.dragState.scrollInterval = null;
    }
  }

  setupEventListeners() {
    // Prevent default touch behaviors on handles
    this.options.list.addEventListener(
      "touchstart",
      (e) => {
        if (e.target.closest(this.options.handleSelector)) {
          e.preventDefault();
        }
      },
      { passive: false }
    );
  }

  destroy() {
    // Stop any ongoing operations
    this.stopAutoScroll();

    // Remove interact.js bindings
    interact(this.options.itemSelector, {
      context: this.options.list,
    }).unset();

    // Clean up any remaining DOM elements
    if (this.dragState.clone) {
      this.dragState.clone.remove();
    }
    if (this.dragState.placeholder) {
      this.dragState.placeholder.remove();
    }
  }

  // Static factory method for convenience
  static create(options) {
    return new SortableList(options);
  }
}
