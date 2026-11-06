import { LAYOUT } from '../render/screen.js';

export const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${LAYOUT.width}px;height:${LAYOUT.height}px;overflow:hidden;background:#fff;color:#000;font-family:'Inter',sans-serif;font-size:40px;font-variant-numeric:tabular-nums}
.screen{width:${LAYOUT.width}px;height:${LAYOUT.height}px;display:flex;flex-direction:column}
.main{flex:1;min-height:0;overflow:hidden;padding:34px 42px 20px;display:flex;flex-direction:column}
.serif{font-family:'Source Serif 4',serif}
.rule{border-top:6px solid #000;margin:20px 0;flex:none}
.meta{font-size:30px;color:#555}
.ellipsis{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.icon{display:inline-flex;vertical-align:-0.12em}
.empty{font-size:38px;color:#555}
.head{display:flex;justify-content:space-between;align-items:baseline}
.head .date{font-size:50px;font-weight:700}
.wx{display:flex;align-items:center;gap:36px}
.wx .temp{font-size:140px;font-weight:700;line-height:1}
.wx .tlabel{font-size:28px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:-6px}
.agenda{flex:1;min-height:0;overflow:hidden}
.section-title.next{margin-top:14px}
.wx .desc{font-size:40px;line-height:1.45}
.rain{display:flex;align-items:flex-start;gap:16px;margin-top:14px}
.rain .hours{flex:1;display:flex;gap:6px}
.rain .h{flex:1;min-width:0}
.rain .b{height:60px;display:flex;align-items:flex-end;border-bottom:3px solid #000}
.rain .bar{width:100%;background:#999}
.rain .bar.wet{background:#000}
.rain .hr{font-size:26px;line-height:32px;color:#555;white-space:nowrap}
.section-title{font-size:30px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px}
.ev{display:flex;align-items:center;gap:20px;font-size:42px;line-height:58px}
.ev .time{min-width:164px;font-weight:700;flex:none}
/* Fixed width (fits «FAM») so titles line up; waste icons take the same width. */
.ev .cal{flex:none;box-sizing:border-box;min-width:84px;text-align:center;font-size:28px;border:3px solid currentColor;border-radius:8px;padding:0 9px;line-height:40px}
.ev .cal.waste{border:none;padding:0;display:flex;align-items:center;justify-content:center}
.ev .ev-title{flex:1;min-width:0}
.ev .ev-title.hidden{flex:none;width:360px;height:.62em;background:currentColor;border-radius:4px}
.guest{display:inline-flex;vertical-align:-4px;margin-left:12px}
/* Two event rows high with its margin (one row when compact); several names in a smaller size so they stay on one line. */
.bday{display:flex;align-items:center;gap:24px;flex:none;height:96px;margin-bottom:16px}
.bday .serif{font-size:64px;font-weight:700;line-height:96px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bday.many .serif{font-size:46px}
.bday.sm{gap:18px;height:50px;margin-bottom:8px}
.bday.sm .serif{font-size:44px;line-height:50px}
.bday.sm.many .serif{font-size:36px}
/* Task box, white on black: 56 px plus a 16 px gap (8 px in the evening), about one event row and a bit. */
.taskbox{display:flex;align-items:center;gap:16px;background:#000;color:#fff;border-radius:12px;height:56px;box-sizing:border-box;padding:0 20px 0 16px;font-size:36px;margin:0 0 16px;flex:none}
.taskbox .t{flex:1;min-width:0}
.taskbox .more-inline{flex:none;font-size:32px}
.agenda.evening .taskbox{margin-bottom:8px}
.bday + .taskbox{margin-top:-6px}
.agenda .section-title{display:flex;align-items:center;justify-content:space-between}
/* The pill is no higher than the title; the transparent padding makes the tap area 80+ px. It reaches
   up only as far as the gap above the title (16 px, evening 8 px), never into the task box. */
.addtask{margin:-16px 0 -32px;padding:16px 0 32px 30px;flex:none}
.agenda.evening .addtask{margin:-8px 0 -40px;padding:8px 0 40px 30px}
.addtask .pill{display:flex;align-items:center;gap:6px;border:3px solid #000;border-radius:8px;font-size:26px;letter-spacing:0;text-transform:none;line-height:30px;padding:0 12px 0 8px}
.ev.past{color:#999}
.more{font-size:32px;color:#555;line-height:50px}
.ev .more-inline{flex:none;font-size:32px;color:#555}
.transit{margin-top:auto;flex:none}
.ov{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.ov .col{padding:0 22px;border-right:3px solid #999;min-width:0}
.ov .col:first-child{padding-left:0}
.ov .col:last-child{border-right:0;padding-right:0}
.ov .stn{font-size:32px;font-weight:700;white-space:nowrap;display:flex;align-items:center;gap:8px}
.ov .dir{font-size:28px;color:#555;margin:4px 0 8px;display:flex;justify-content:space-between;gap:8px;white-space:nowrap}
.ov .dir b{color:#000}
/* Out of reach on foot */
.dep.gone,.st-dep.gone{color:#999}
.dep.gone .line,.st-dep.gone .line{background:#999}
.ov .dep{font-size:42px;line-height:60px;display:flex;align-items:center;gap:12px;font-variant-numeric:tabular-nums}
.ov .delay{font-size:28px;font-weight:700}
/* Late departures: the time inverted, so it stands out from a distance. */
.late{background:#000;color:#fff;border-radius:6px;padding:0 6px;margin-left:-6px}
.ov .none{font-size:30px;color:#555;line-height:60px}
.view-station .st-out{margin-top:30px}
.wn{display:flex;align-items:center;gap:36px}
.wn{flex:none}
/* Night screen */
.gn{display:flex;align-items:center;justify-content:center;gap:36px;padding:70px 0 60px;flex:none}
.gn .serif{font-size:110px;font-weight:700;line-height:1}
.nw{display:flex;align-items:center;gap:30px;margin:6px 0 26px;flex:none}
.nw-text{font-size:48px;font-weight:700;line-height:1.2}
.nw-sub{font-size:38px;line-height:1.4;color:#555}
.nw-sub b{color:#000}
.nevents{flex:1;min-height:0;overflow:hidden}
.view-wetter .rule{margin:15px 0}
.wn .temp{font-size:104px;font-weight:700;line-height:1}
.wn-desc{font-size:38px;line-height:1.35}
/* Black, not grey: small grey text is hard to read on e-ink. */
.wn-desc .sub{font-size:34px;color:#000}
/* flex:none: never let the column squeeze a chart; too much content must show as overflow. */
.chart,.gauge{display:block;flex:none;font-family:'Inter',sans-serif}
.chart .lbl{font-size:32px;font-weight:700}
.chart .ax{font-size:26px;fill:#555}
.chart .wl{font-size:26px;font-weight:700}
.hicons{position:relative;height:44px;flex:none}
.hicons span{position:absolute;top:0}
/* A fine divider between wind and barometer that stops short of both rules. */
.gauges{display:grid;grid-template-columns:1fr 1fr;flex:none;position:relative}
.gauges::before{content:'';position:absolute;left:50%;top:20px;bottom:20px;border-left:2px solid #999}
.gauges .g{display:flex;flex-direction:column;align-items:center}
.gauge .cardinal{font-size:40px;font-weight:700}
.gauge .num{font-size:26px;fill:#555}
.gauge .zone{font-size:32px;font-weight:700}
.gauges .gv{font-size:42px;font-weight:700;line-height:1.15}
.gauges .gs{font-size:30px;color:#555;min-height:36px}
.wdays{display:flex;flex-direction:column;flex:none}
.wday{display:grid;grid-template-columns:96px 44px 64px 70px 552px 1fr;align-items:center;column-gap:12px;font-size:34px;line-height:38px}
.wd-head .section-title{grid-column:1 / 5;margin-bottom:4px}
.wd-head .dayrain{grid-column:5}
.wday .dayrain{display:block}
.dayrain .rh{font-size:22px;font-weight:700;fill:#555;letter-spacing:.04em}
.wd-head .rh-label{font-size:22px;font-weight:700;color:#555;letter-spacing:.06em;text-transform:uppercase;line-height:30px;align-self:end}
.wday .mm{font-size:26px;color:#000;font-weight:700;white-space:nowrap}
.wday .lo{text-align:right;color:#555}
.wday .hi{text-align:right;font-weight:700}
.st-dep{display:flex;align-items:center;gap:20px;font-size:42px;line-height:64px;border-bottom:2px solid #999}
.st-dep .time{min-width:120px;font-weight:700}
.st-dep .line{min-width:64px}
.st-dep .to{flex:1;min-width:0}
.st-dep .delay{font-size:30px;font-weight:700}
.view-station .none{font-size:36px;color:#555;line-height:64px}
.line{display:inline-block;background:#000;color:#fff;font-weight:700;font-size:30px;line-height:40px;border-radius:8px;padding:0 10px;min-width:46px;text-align:center}
.line.rail{background:#fff;color:#000;border:4px solid #000;line-height:32px}
.line.sm{font-size:24px;line-height:32px;min-width:54px;padding:0 6px}
.widget{flex:none;height:150px;display:flex;align-items:center;gap:30px;background:#ececec;border-top:6px solid #000;padding:0 42px}
/* The whole text side opens Einkauf: full widget height, so the tap area is large. */
.widget .txt{flex:1;min-width:0;align-self:stretch;display:flex;flex-direction:column;justify-content:center}
.widget .lbl{font-size:28px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#000;display:flex;align-items:center;gap:10px}
.widget .items{font-size:38px;margin-top:4px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:#000;color:#fff;font-weight:700;font-size:36px;border-radius:14px;padding:0 30px;height:96px;white-space:nowrap;flex:none}
/* On Heute the button only has an outline, on the grey of the widget. */
.widget .btn{background:transparent;color:#000;border:4px solid #000;box-sizing:border-box}
.tabs{flex:none;height:130px;display:flex;border-top:6px solid #000}
.tabs .tab{flex:1;display:flex;align-items:center;justify-content:center;font-size:36px;border-right:3px solid #999}
.tabs .tab:last-child{border-right:0}
.tabs .tab.on{background:#000;color:#fff;font-weight:700}
.title{font-size:56px;font-weight:700}
.week{display:grid;grid-template-columns:170px 1fr;margin-top:10px}
.week .dw{display:flex;align-items:center;gap:6px;font-size:26px;font-weight:400;line-height:34px;white-space:nowrap}
.week .day,.week .entries{border-top:3px solid #999;padding:10px 0}
.week .day{font-weight:700;font-size:36px;line-height:46px}
.week .entries{min-width:0}
.week .today{background:#ececec}
.week .ev{font-size:36px;line-height:46px}
.week .ev .time{min-width:120px}
.week .ev .cal{font-size:28px;line-height:34px}
.week .more{font-size:28px;line-height:40px}
.week .dash{font-size:34px;line-height:46px;color:#555}
.items-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px}
.item{border:4px solid #000;border-radius:14px;padding:16px 22px;font-size:40px;min-height:100px;min-width:0}
.item small{display:block;font-size:28px;color:#555}
.btn.wide{display:flex;width:100%;height:120px;margin-top:26px;font-size:42px}
/* Pager at the bottom of Einkauf, above the tabs. */
.pager{margin-top:auto;padding-top:20px;display:flex;align-items:center;justify-content:space-between;gap:20px;flex:none}
.pg{display:flex;align-items:center;gap:6px;height:88px;box-sizing:border-box;border:4px solid #000;border-radius:12px;padding:0 26px;font-size:34px;font-weight:700}
.pg.off{border-color:#999;color:#999}
.pgn{font-size:32px}
.topbar{display:flex;justify-content:space-between;align-items:center}
.close{border:4px solid #000;border-radius:12px;font-size:34px;padding:14px 26px;display:flex;align-items:center;gap:8px}
.input{border:6px solid #000;border-radius:14px;height:110px;display:flex;align-items:center;font-size:52px;padding-left:26px}
.input .text{flex:1;min-width:0}
.input .caret{display:inline-block;width:4px;height:56px;background:#000;vertical-align:middle;margin-left:4px}
.input .bs{width:120px;height:100%;display:flex;align-items:center;justify-content:center;border-left:4px solid #000}
.sugg{display:flex;gap:14px;margin-top:16px;height:96px}
.sugg .s{flex:1;min-width:0;border:5px solid #000;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:700;padding:0 12px}
.sugg .s.blank{border-style:dashed;border-color:#999}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:8px}
.tile{height:92px;border:4px solid #000;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:34px;padding:0 10px;min-width:0}
/* The keyboard sits at the bottom edge, whatever is above it. */
.kb{margin-top:auto;padding-top:18px;display:flex;flex-direction:column;gap:10px}
.kb .row{display:flex;gap:8px;justify-content:center}
.key{width:82px;height:96px;border:3px solid #000;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:38px;flex:none}
.key.mid{width:176px}
.key.wide{width:390px}
.key.enter{width:390px;background:#000;color:#fff;font-weight:700}
.notice{display:flex;align-items:center;gap:14px;height:96px;border:5px solid #000;border-radius:12px;padding-left:22px;font-size:38px;font-weight:700;flex:none;overflow:hidden}
.notice.ok{background:#000;color:#fff}
.notice .ellipsis{flex:1;min-width:0}
.notice .undo{align-self:stretch;display:flex;align-items:center;gap:8px;padding:0 30px;background:#fff;color:#000;border-left:5px solid #000;font-size:36px;flex:none}
.view-hinzufuegen .notice{margin-top:16px}
.view-einkauf .notice{margin-top:22px}
.item{position:relative;padding-right:84px;display:flex;flex-direction:column;justify-content:center}
.item{padding-right:170px}
.item .tick{position:absolute;right:110px;top:50%;transform:translateY(-50%);width:48px;height:48px;border:3px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center}
/* «Dringend»: the right 90 px of a tile, behind a divider; an urgent tile is black. */
.item .urge{position:absolute;top:0;right:0;bottom:0;width:90px;border-left:3px solid currentColor;display:flex;align-items:center;justify-content:center}
.item.urgent{background:#000;color:#fff}
.item.urgent small{color:#ececec}
.item.urgent .tick{border-color:#fff}
.tile.on{background:#000;color:#fff;gap:8px}
.segs{display:flex;border:4px solid #000;border-radius:12px;overflow:hidden}
.segs .seg{font-size:36px;padding:18px 30px;font-weight:700}
.segs .seg.on{background:#000;color:#fff}
.view-hinzufuegen .tiles.two{grid-template-columns:1fr 1fr}
`;
