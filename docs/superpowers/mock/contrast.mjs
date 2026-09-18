const hex = h => h.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);
const L = h => { const [r,g,b]=hex(h); return 0.2126*r+0.7152*g+0.0722*b; };
const cr = (a,b) => { const [x,y]=[L(a),L(b)].sort((p,q)=>q-p); return ((x+0.05)/(y+0.05)).toFixed(2); };
const pairs = [
 ['#1C1917','#EB7837','ink on brand orange'],
 ['#FFFFFF','#EB7837','white on brand orange'],
 ['#EB7837','#FFFFFF','orange text on white'],
 ['#C2571B','#FFFFFF','orange-600 on white'],
 ['#B04E17','#FFFFFF','orange-700 on white'],
 ['#A94A15','#FDF1E8','orange-700 on orange-50'],
 ['#78716C','#FFFFFF','stone-500 on white'],
 ['#6B645E','#FFFFFF','muted on white'],
 ['#6B645E','#F7F5F2','muted on canvas'],
 ['#57534E','#FFFFFF','secondary on white'],
 ['#1C1917','#F7F5F2','ink on canvas'],
 ['#1A7F4B','#E7F5EC','success text on success bg'],
 ['#8A5A00','#FDF3D7','warn text on warn bg'],
 ['#B42318','#FDECEA','danger on danger bg'],
 ['#2458C6','#EAF1FD','info on info bg'],
 ['#F2EDE6','#141210','sand on dark surface'],
 ['#A39B93','#141210','dust on dark surface'],
 ['#EB7837','#141210','orange on dark surface'],
 ['#F59A5E','#141210','orange-light on dark'],
 ['#1C1917','#F59A5E','ink on orange-light'],
];
for (const [a,b,n] of pairs) console.log(cr(a,b).padStart(6), n, a, b);
