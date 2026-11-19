import io
s=open('/home/project/js/app.js',encoding='utf-8').read()
patch='''/* 全局错误捕捉: 真机上任何脚本错误都可视化, 避免按钮没反应却查不到原因 */
function bindGlobalErrorReport() {
  window.addEventListener("error", (e) => {
    const msg = (e && e.message) || "未知脚本错误";
    toast("脚本错误: " + msg, "error", 9000);
    console.error("[global]", e && e.error || e);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e && e.reason;
    toast("异步错误: " + ((r && (r.message || r)) || "未知"), "error", 9000);
    console.error("[unhandled]", r);
  });
}

/* 自救: 若按钮卡在禁用但没有进行中的请求, 回到页面时自动恢复 */
window.addEventListener("pageshow", () => {
  if (!generating && $("generateBtn") && $("generateBtn").disabled) setGenerating(false);
});

function init() {'''
old='function init() {'
assert s.count(old)==1, 'init anchor mismatch'
s=s.replace(old,patch)
old2='''  $("generateBtn").addEventListener("click", generate);'''
assert s.count(old2)==1, 'bind anchor mismatch'
s=s.replace(old2,'''  bindGlobalErrorReport();
  $("generateBtn").addEventListener("click", generate);''')
open('/home/project/js/app.js','w',encoding='utf-8').write(s)
h=open('/home/project/index.html',encoding='utf-8').read()
assert h.count('js/app.js?v=20261119d')==1
h=h.replace('js/app.js?v=20261119d','js/app.js?v=20261119e')
open('/home/project/index.html','w',encoding='utf-8').write(h)
print('patched ok')
