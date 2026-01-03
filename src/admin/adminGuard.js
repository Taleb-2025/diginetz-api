// adminGuard.js

(function () {
  const FLAG_KEY = "__TSL_ADMIN_GRANTED__";

  function deny() {
    document.body.innerHTML = "";
    document.body.style.background = "#0e0f13";
    document.body.style.color = "#ff4444";
    document.body.style.fontFamily = "monospace";
    document.body.style.display = "flex";
    document.body.style.alignItems = "center";
    document.body.style.justifyContent = "center";
    document.body.style.height = "100vh";
    document.body.innerHTML = "<h2>ACCESS DENIED</h2>";
    throw new Error("ADMIN_ACCESS_DENIED");
  }

  function allow() {
    document.documentElement.classList.add("admin-mode");
  }

  try {
    const granted = sessionStorage.getItem(FLAG_KEY);
    if (granted === "true") {
      allow();
    } else {
      deny();
    }
  } catch (e) {
    deny();
  }
})();
