package dev.kaipi.android;

import android.app.*;
import android.os.Bundle;
import android.content.*;
import android.graphics.Color;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.webkit.*;
import android.widget.*;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.Semaphore;

/** Android chrome only. Each tab owns a PTY; kaipi owns its conversation data. */
public final class MainActivity extends Activity {
    private final List<Tab> tabs = new ArrayList<>();
    private FrameLayout terminals;
    private Button selector, ctrl;
    private Tab active;
    private boolean destroyed;
    private SharedPreferences prefs;
    private static final int BG = 0xff101411, FG = 0xffe3e9df, ACCENT = 0xffa3e635;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
            WebView.setWebContentsDebuggingEnabled(true);
        prefs = getSharedPreferences("tabs", MODE_PRIVATE);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(BG);
        LinearLayout header = new LinearLayout(this); header.setGravity(Gravity.CENTER_VERTICAL);
        selector = button("kaipi", v -> chooseTab()); selector.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        selector.setOnLongClickListener(v -> {tabMenu(); return true;});
        header.addView(selector, new LinearLayout.LayoutParams(0, dp(56), 1));
        header.addView(button("+", v -> newTab()));
        header.addView(button("⋮", v -> tabMenu())); root.addView(header);
        terminals = new FrameLayout(this); root.addView(terminals, new LinearLayout.LayoutParams(-1, 0, 1));
        HorizontalScrollView scroll = new HorizontalScrollView(this); scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout keys = new LinearLayout(this);
        String[][] shortcuts = {{"↑","up"},{"↓","down"},{"←","left"},{"→","right"},{"/","slash"},{"Tab","tab"},{"Esc","esc"}};
        for (String[] key : shortcuts) addKey(keys,key[0],key[1]);
        ctrl = button("Ctrl", v -> {active.control = !active.control; updateHeader(); active.js("kaipi.ctrl("+active.control+")");});
        keys.addView(ctrl); addKey(keys,"^C","interrupt"); addKey(keys,"↵","enter");
        keys.addView(button("键盘", v -> {
            active.web.requestFocus(); active.js("kaipi.focus()");
            ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(active.web, InputMethodManager.SHOW_IMPLICIT);
        }));
        scroll.addView(keys); root.addView(scroll,new LinearLayout.LayoutParams(-1,dp(52)));
        setContentView(root);
        try {
            JSONArray stored = new JSONArray(prefs.getString("list","[]"));
            for (int i=0; i<stored.length(); i++) {
                JSONObject item=stored.getJSONObject(i); String id=item.getString("id"); UUID.fromString(id);
                tabs.add(new Tab(id,item.getString("name")));
            }
        } catch (JSONException | IllegalArgumentException e) {tabs.clear();}
        if (tabs.isEmpty()) newTab();
        else select(tabs.stream().filter(t -> t.id.equals(prefs.getString("active",""))).findFirst().orElse(tabs.get(0)));
    }
    private Button button(String text, View.OnClickListener action) {
        Button b = new Button(this); b.setText(text); b.setTextColor(FG); b.setTextSize(14); b.setAllCaps(false);
        b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(dp(8),0,dp(8),0); b.setFocusable(false);
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(text.length()>2?64:48),dp(48)));
        b.setContentDescription(text); b.setOnClickListener(action); return b;
    }
    private void addKey(LinearLayout row,String label,String key) {
        Button b=button(label,v -> active.js("kaipi.key("+JSONObject.quote(key)+")"));
        b.setContentDescription(switch(key){case "up"->"向上";case "down"->"向下";case "left"->"向左";case "right"->"向右";case "interrupt"->"中断 Ctrl C";default->label;});row.addView(b);
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private void updateHeader() {
        if(active==null || destroyed)return;
        selector.setText(active.name+" ▾\n"+active.status); selector.setContentDescription("切换会话，当前"+active.name);
        ctrl.setTextColor(active.control?ACCENT:FG); ctrl.setText(active.control?"Ctrl ●":"Ctrl");
    }
    private void newTab(){Tab t=new Tab(UUID.randomUUID().toString(),"会话 "+(tabs.size()+1));tabs.add(t);select(t);}
    private void select(Tab tab) {
        if(active!=null && active.web!=null)active.web.setVisibility(View.GONE);
        active=tab; tab.open(); tab.web.setVisibility(View.VISIBLE);tab.web.requestFocus();tab.js("kaipi.ready();kaipi.focus()");
        updateHeader();saveTabs();
    }
    private void chooseTab() {
        String[] labels=tabs.stream().map(t -> (t==active?"● ":"")+t.name).toArray(String[]::new);
        new AlertDialog.Builder(this).setTitle("会话").setItems(labels,(d,i)->select(tabs.get(i)))
            .setPositiveButton("新建会话",(d,w)->newTab()).setNegativeButton("取消",null).show();
    }
    private void tabMenu() {
        Tab tab=active;
        new AlertDialog.Builder(this).setTitle(tab.name).setItems(new String[]{"重命名","重启终端","关闭会话"},(d,index)->{
            if(index==0){
                EditText name=new EditText(this);name.setSingleLine(true);name.setText(tab.name);
                new AlertDialog.Builder(this).setTitle("会话名称").setView(name).setNegativeButton("取消",null)
                    .setPositiveButton("保存",(x,w)->{String value=name.getText().toString().trim();if(!value.isEmpty()){tab.name=value.substring(0,Math.min(40,value.length()));updateHeader();saveTabs();}}).show();
            } else {
                new AlertDialog.Builder(this).setTitle(index==1?"重启终端？":"关闭会话？")
                    .setMessage("将结束此终端；已保存的 kaipi 会话文件保留。").setNegativeButton("取消",null)
                    .setPositiveButton("确定",(x,w)->{
                        if(index==1)tab.start();
                        else {tab.dispose();tabs.remove(tab);if(tabs.isEmpty())newTab();else select(tabs.get(0));}
                    }).show();
            }
        }).show();
    }
    private void saveTabs() {
        JSONArray list=new JSONArray();
        try {for(Tab t:tabs)list.put(new JSONObject().put("id",t.id).put("name",t.name));}
        catch(JSONException impossible){throw new IllegalStateException(impossible);}
        prefs.edit().putString("list",list.toString()).putString("active",active.id).apply();
    }

    private final class Tab {
        final String id;
        Semaphore outputSlots=new Semaphore(16);
        String name,status="尚未启动";
        WebView web;
        volatile LocalTerminal process;
        boolean ready,control,disposed;
        int generation,columns=80,rows=24;
        Tab(String id,String name){this.id=id;this.name=name;}
        void open() {
            if(web!=null)return;
            status="加载终端…";
            web=new WebView(MainActivity.this);web.setBackgroundColor(BG);
            web.getSettings().setJavaScriptEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);
            web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            web.addJavascriptInterface(new Bridge(),"Native");
            web.setWebViewClient(new WebViewClient(){
                @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}
                @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest request){
                    String prefix="https://app.kaipi.invalid/",url=request.getUrl().toString();
                    if(url.startsWith(prefix)) {
                        String path=url.substring(prefix.length());
                        if(!path.contains("..") && !path.contains("%"))try{
                            WebResourceResponse response=new WebResourceResponse(path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":"text/html","UTF-8",getAssets().open("terminal/"+path));
                            response.setResponseHeaders(Collections.singletonMap("Cache-Control","no-store"));
                            return response;
                        }catch(IOException ignored){}
                    }
                    return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
                }
            });
            terminals.addView(web,new FrameLayout.LayoutParams(-1,-1));web.loadUrl("https://app.kaipi.invalid/index.html");
        }
        void js(String code){if(ready && !disposed && !destroyed)web.evaluateJavascript(code,null);}
        void start() {
            if(!ready || disposed)return;
            generation++;if(process!=null)process.close();
            control=false;status="正在启动…";js("kaipi.ctrl(false);kaipi.reset()");updateHeader();
            int started=generation;
            Semaphore slots=new Semaphore(16);outputSlots=slots;
            process=new LocalTerminal(new LocalTerminal.Listener(){
                public void output(byte[] bytes){
                    try{slots.acquire();}catch(InterruptedException e){Thread.currentThread().interrupt();return;}
                    String data=Base64.encodeToString(bytes,Base64.NO_WRAP);
                    runOnUiThread(()->{
                        if(destroyed || disposed || generation!=started){slots.release();return;}
                        web.evaluateJavascript("kaipi.output("+JSONObject.quote(data)+","+started+")",null);
                    });
                }
                public void status(String message){runOnUiThread(()->{if(!disposed && generation==started){status=message;updateHeader();}});}
            });
            process.start(getApplicationContext(),new File(getFilesDir(),"workspaces/"+id),columns,rows);
        }
        void dispose(){disposed=true;generation++;if(process!=null)process.close();if(web!=null){terminals.removeView(web);web.removeJavascriptInterface("Native");web.destroy();}}
        public final class Bridge {
            @JavascriptInterface public void consumed(int id){runOnUiThread(()->{if(id==generation)outputSlots.release();});}
            @JavascriptInterface public void ready(){runOnUiThread(()->{if(!disposed){ready=true;js("kaipi.ready()");start();}});}
            @JavascriptInterface public void send(String data){LocalTerminal p=process;if(p!=null && data.length()<=1048576)p.send(data);}
            @JavascriptInterface public void resize(int cols,int lines){runOnUiThread(()->{columns=cols;rows=lines;if(process!=null)process.resize(cols,lines);});}
            @JavascriptInterface public void ctrlReleased(){runOnUiThread(()->{control=false;updateHeader();});}
        }
    }
    @Override protected void onDestroy(){destroyed=true;for(Tab t:tabs)t.dispose();super.onDestroy();}
}
